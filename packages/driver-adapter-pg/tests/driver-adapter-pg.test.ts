import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
  AshibaParameterError,
  createPostgresAdapter,
  type AshibaPostgresQueryModel,
  type NodePostgresQueryable,
} from '../src/index.js';
import { AshibaSortError, type AshibaSqlExecutionEvent } from '@ashiba/driver-adapter-core';

describe('@ashiba/driver-adapter-pg', () => {
  test('executes named-parameter SQL through a pg compatible client', async () => {
    const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
    const client: NodePostgresQueryable = {
      async query(sql, values) {
        calls.push({ sql, values });
        return { rows: [{ user_id: 1 }], rowCount: 1 };
      },
    };
    const adapter = createPostgresAdapter(client);
    const sourceSql = 'select * from users where id = :id';

    const result = await adapter.execute(querySource(sourceSql, queryModelFor(sourceSql, {
        sql: 'select * from users where id = $1',
        orderedNames: ['id'],
      })), { id: 1 },{});

    expect(result.rows).toEqual([{ user_id: 1 }]);
    expect(calls).toEqual([{ sql: 'select * from users where id = $1', values: [1] }]);
  });

  test('uses precomputed query model binding when source hash matches', async () => {
    const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
    const sourceSql = 'select * from users where id = :id and status = :status';
    const client: NodePostgresQueryable = {
      async query(sql, values) {
        calls.push({ sql, values });
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client);

    await adapter.execute(querySource(sourceSql, {
          analysis: {
            astParse: 'ok',
            statementKind: 'select',
            hasTopLevelOrderBy: true,
            sourceHash: hashSql(sourceSql),
          },
          bindings: {
            postgres: {
              sourceHash: hashSql(sourceSql),
              sql: 'select * from users where id = $1 and status = $2',
              orderedNames: ['id', 'status'],
            },
          },
        }),
      { id: 1, status: 'active' },{},
    );

    expect(calls).toEqual([{ sql: 'select * from users where id = $1 and status = $2', values: [1, 'active'] }]);
  });

  test('rejects stale precomputed query model binding', async () => {
    let called = false;
    const sourceSql = 'select * from users where id = :id';
    const client: NodePostgresQueryable = {
      async query() {
        called = true;
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client);

    await expect(adapter.execute(querySource(sourceSql, {
          analysis: {
            astParse: 'ok',
            statementKind: 'select',
            hasTopLevelOrderBy: false,
            sourceHash: hashSql('select * from other_users where id = :id'),
          },
          bindings: {
            postgres: {
              sourceHash: hashSql('select * from other_users where id = :id'),
              sql: 'select * from other_users where id = $1',
              orderedNames: ['id'],
            },
          },
        }),
      { id: 1 },{},
    )).rejects.toMatchObject({ code: 'ASHIBA_QUERY_MODEL_STALE' });

    expect(called).toBe(false);
  });

  test('rejects runtime parameter binding without CLI-generated metadata', async () => {
    let called = false;
    const client: NodePostgresQueryable = {
      async query() {
        called = true;
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client);

    await expect(adapter.execute(querySource('select * from users where id = :id', {
      analysis: {
        astParse: 'ok',
        statementKind: 'select',
        hasTopLevelOrderBy: false,
        sourceHash: hashSql('select * from users where id = :id'),
      },
    }), { id: 1 }))
      .rejects.toMatchObject({
        code: 'ASHIBA_BINDING_METADATA_REQUIRED',
        causeText: 'The PostgreSQL adapter is running in metadata-based binding mode, but the query model did not include Postgres binding metadata.',
        nextAction: 'Run Ashiba model generation for the visible SQL and pass queryModel.bindings.postgres to the adapter.',
      });

    expect(called).toBe(false);
  });

  test('emits masked logger-ready events', async () => {
    const events: AshibaSqlExecutionEvent[] = [];
    const client: NodePostgresQueryable = {
      async query() {
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client, {
      observer: {
        emit(event) {
          events.push(event);
        },
      },
    });

    const sourceSql = 'select :secret';
    await adapter.execute(querySource(sourceSql, queryModelFor(sourceSql, {
        sql: 'select $1',
        orderedNames: ['secret'],
      })), { secret: 'value' },{
      metadata: { queryId: 'q1' }});

    expect(events.map((event) => event.phase)).toEqual(['start', 'end']);
    expect(events[0]?.metadata?.queryId).toBe('q1');
    expect(events[1]?.sourceSql).toBe('select :secret');
    expect(events[0]?.maskedParams).toEqual(['<masked>']);
    expect(events[0]?.params).toBeUndefined();
  });

  test('emits logger-ready error events for pre-execution parameter failures', async () => {
    const events: AshibaSqlExecutionEvent[] = [];
    let called = false;
    const client: NodePostgresQueryable = {
      async query() {
        called = true;
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client, {
      observer: {
        emit(event) {
          events.push(event);
        },
      },
    });

    await expect(adapter.execute(querySource('select :id', queryModelFor('select :id', {
          sql: 'select $1',
          orderedNames: ['id'],
        })),
      {},{
        metadata: { queryId: 'users.get', sqlPath: 'src/features/users/queries/get/get.sql' }},
    )).rejects.toThrow(AshibaParameterError);

    expect(called).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      phase: 'error',
      metadata: {
        queryId: 'users.get',
        sqlPath: 'src/features/users/queries/get/get.sql',
        dialect: 'postgres',
      },
      sourceSql: 'select :id',
      error: {
        code: 'ASHIBA_MISSING_PARAMETER',
        cause: 'The provided parameter object does not include every named SQL parameter required by the query model.',
        nextAction: 'Pass values for the listed parameters or regenerate the query contract if the SQL changed.',
      },
    });
    expect(events[0]?.compiledSql).toBeUndefined();
    expect(events[0]?.maskedParams).toBeUndefined();
  });

  test('compresses optional conditions only when explicitly enabled', async () => {
    const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
    const sourceSql = 'select * from users where tenant_id = :tenant_id and (:status is null or status = :status)';
    const compiledSql = 'select * from users where tenant_id = $1 and ($2 is null or status = $3)';
    const client: NodePostgresQueryable = {
      async query(sql, values) {
        calls.push({ sql, values });
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client);

    await adapter.execute(querySource(sourceSql, queryModelFor(sourceSql, {
          sql: compiledSql,
          orderedNames: ['tenant_id', 'status', 'status'],
          optionalConditionCompression: optionalCompressionBinding(compiledSql, 'status', 'and ($2 is null or status = $3)'),
        }, {
          optionalConditionCompression: optionalCompressionAnalysis(sourceSql, 'status', 'and (:status is null or status = :status)'),
        })),
      { tenant_id: 10, status: null },{
        optionalConditionCompression: true},
    );

    expect(calls).toEqual([{
      sql: 'select * from users where tenant_id = $1 ',
      values: [10],
    }]);
  });

  test('keeps optional conditions when compression is not enabled', async () => {
    const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
    const sourceSql = 'select * from users where tenant_id = :tenant_id and (:status is null or status = :status)';
    const compiledSql = 'select * from users where tenant_id = $1 and ($2 is null or status = $3)';
    const client: NodePostgresQueryable = {
      async query(sql, values) {
        calls.push({ sql, values });
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client);

    await adapter.execute(querySource(sourceSql, queryModelFor(sourceSql, {
          sql: compiledSql,
          orderedNames: ['tenant_id', 'status', 'status'],
          optionalConditionCompression: optionalCompressionBinding(compiledSql, 'status', 'and ($2 is null or status = $3)'),
        }, {
          optionalConditionCompression: optionalCompressionAnalysis(sourceSql, 'status', 'and (:status is null or status = :status)'),
        })),
      { tenant_id: 10, status: null },{},
    );

    expect(calls).toEqual([{
      sql: compiledSql,
      values: [10, null, null],
    }]);
  });

  test('rejects optional condition compression when metadata is missing', async () => {
    let called = false;
    const sourceSql = 'select * from users where id = :id';
    const client: NodePostgresQueryable = {
      async query() {
        called = true;
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client);

    await expect(adapter.execute(querySource(sourceSql, queryModelFor(sourceSql, {
        sql: 'select * from users where id = $1',
        orderedNames: ['id'],
      })), { id: 1 },{
      optionalConditionCompression: true})).rejects.toMatchObject({
      code: 'ASHIBA_OPTIONAL_CONDITION_COMPRESSION_METADATA_REQUIRED',
      nextAction: 'Regenerate the query model with optional condition compression metadata, or disable optionalConditionCompression for this execution.',
    });
    expect(called).toBe(false);
  });

  test('rejects optional condition compression when query model AST analysis failed', async () => {
    let called = false;
    const sourceSql = 'select * from users where id = :id';
    const client: NodePostgresQueryable = {
      async query() {
        called = true;
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client);

    await expect(adapter.execute(querySource(sourceSql, queryModelFor(sourceSql, {
        sql: 'select * from users where id = $1',
        orderedNames: ['id'],
        optionalConditionCompression: { branches: [] },
      }, {
        astParse: 'failed',
        optionalConditionCompression: { enabled: true, branches: [] },
      })), { id: 1 },{
      optionalConditionCompression: true})).rejects.toMatchObject({
      code: 'ASHIBA_OPTIONAL_CONDITION_COMPRESSION_UNSUPPORTED_QUERY_MODEL',
      nextAction: 'Fix the SQL shape or parser support, then regenerate the query model before enabling optionalConditionCompression.',
    });
    expect(called).toBe(false);
  });

  test('combines optional condition compression, named parameters, and safe sort metadata', async () => {
    const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
    const sourceSql = 'select a.user_id as id from users a where a.tenant_id = :tenant_id and (:status is null or a.status = :status) limit :limit';
    const compiledSql = 'select a.user_id as id from users a where a.tenant_id = $1 and ($2 is null or a.status = $3) limit $4';
    const client: NodePostgresQueryable = {
      async query(sql, values) {
        calls.push({ sql, values });
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client);

    await adapter.execute(querySource(sourceSql, queryModelFor(sourceSql, {
          sql: compiledSql,
          orderedNames: ['tenant_id', 'status', 'status', 'limit'],
          safeSortInsertion: { index: compiledSql.indexOf('limit $4') },
          optionalConditionCompression: optionalCompressionBinding(compiledSql, 'status', 'and ($2 is null or a.status = $3)'),
        }, {
          rootQueryShape: 'simple-select',
          safeSort: {
            insertion: { status: 'ready', index: sourceSql.indexOf('limit :limit'), mode: 'order-by' },
            sortable: { id: { sql: 'a.user_id' } },
          },
          optionalConditionCompression: optionalCompressionAnalysis(sourceSql, 'status', 'and (:status is null or a.status = :status)'),
        })),
      { tenant_id: 7, status: null, limit: 10 },{
        optionalConditionCompression: true,
        sort: [{ key: 'id', direction: 'desc' }]},
    );

    expect(calls).toEqual([{
      sql: 'select a.user_id as id from users a where a.tenant_id = $1 order by a.user_id desc limit $2',
      values: [7, 10],
    }]);
  });

  test('renumbers placeholders above $10 after optional condition compression and safe sort', async () => {
    const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
    const beforeNames = Array.from({ length: 9 }, (_, index) => `p${String(index + 1).padStart(2, '0')}`);
    const afterNames = Array.from({ length: 3 }, (_, index) => `p${String(index + 10).padStart(2, '0')}`);
    const beforeSource = beforeNames.map((name) => `a.${name} = :${name}`).join(' and ');
    const afterSource = afterNames.map((name) => `a.${name} = :${name}`).join(' and ');
    const beforeCompiled = beforeNames.map((name, index) => `a.${name} = $${index + 1}`).join(' and ');
    const afterCompiled = afterNames.map((name, index) => `a.${name} = $${index + 12}`).join(' and ');
    const afterRenumbered = afterNames.map((name, index) => `a.${name} = $${index + 10}`).join(' and ');
    const sourceSql = `select a.user_id as id from users a where ${beforeSource} and (:status is null or a.status = :status) and ${afterSource} order by a.created_at`;
    const compiledSql = `select a.user_id as id from users a where ${beforeCompiled} and ($10 is null or a.status = $11) and ${afterCompiled} order by a.created_at`;
    const client: NodePostgresQueryable = {
      async query(sql, values) {
        calls.push({ sql, values });
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client);

    await adapter.execute(querySource(sourceSql, queryModelFor(sourceSql, {
          sql: compiledSql,
          orderedNames: [...beforeNames, 'status', 'status', ...afterNames],
          safeSortInsertion: { index: compiledSql.length },
          optionalConditionCompression: optionalCompressionBinding(compiledSql, 'status', 'and ($10 is null or a.status = $11)'),
        }, {
          rootQueryShape: 'simple-select',
          safeSort: {
            insertion: { status: 'ready', index: sourceSql.length, mode: 'comma' },
            sortable: { id: { sql: 'a.user_id' } },
          },
          optionalConditionCompression: optionalCompressionAnalysis(sourceSql, 'status', 'and (:status is null or a.status = :status)'),
        })),
      Object.fromEntries([
        ...beforeNames.map((name, index) => [name, index + 1] as const),
        ['status', null] as const,
        ...afterNames.map((name, index) => [name, index + 10] as const),
      ]),{
        optionalConditionCompression: true,
        sort: [{ key: 'id' }]},
    );

    expect(calls).toEqual([{
      sql: `select a.user_id as id from users a where ${beforeCompiled}  and ${afterRenumbered} order by a.created_at, a.user_id asc`,
      values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    }]);
  });

  test('keeps SQL-like parameter values bound when optional condition compression and safe sort compose', async () => {
    const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
    const sourceSql = 'select a.user_id as id from users a where a.tenant_id = :tenant_id and (:status is null or a.status = :status) and (:email is null or a.email = :email)';
    const compiledSql = 'select a.user_id as id from users a where a.tenant_id = $1 and ($2 is null or a.status = $3) and ($4 is null or a.email = $5)';
    const injectedEmail = "x@example.test' or 1=1; drop table users;--";
    const client: NodePostgresQueryable = {
      async query(sql, values) {
        calls.push({ sql, values });
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client);

    await adapter.execute(querySource(sourceSql, queryModelFor(sourceSql, {
          sql: compiledSql,
          orderedNames: ['tenant_id', 'status', 'status', 'email', 'email'],
          safeSortInsertion: { index: compiledSql.length },
          optionalConditionCompression: {
            branches: [
              ...optionalCompressionBinding(compiledSql, 'status', 'and ($2 is null or a.status = $3)').branches,
              ...optionalCompressionBinding(compiledSql, 'email', 'and ($4 is null or a.email = $5)').branches,
            ],
          },
        }, {
          rootQueryShape: 'simple-select',
          safeSort: {
            insertion: { status: 'ready', index: sourceSql.length, mode: 'order-by' },
            sortable: { id: { sql: 'a.user_id' } },
          },
          optionalConditionCompression: {
            enabled: true,
            branches: [
              ...optionalCompressionAnalysis(sourceSql, 'status', 'and (:status is null or a.status = :status)').branches,
              ...optionalCompressionAnalysis(sourceSql, 'email', 'and (:email is null or a.email = :email)').branches,
            ],
          },
        })),
      { tenant_id: 7, status: null, email: injectedEmail },{
        optionalConditionCompression: true,
        sort: [{ key: 'id', direction: 'desc' }]},
    );

    expect(calls).toEqual([{
      sql: 'select a.user_id as id from users a where a.tenant_id = $1  and ($2 is null or a.email = $3) order by a.user_id desc',
      values: [7, injectedEmail, injectedEmail],
    }]);
    expect(calls[0]?.sql).not.toContain(injectedEmail);
  });

  test('does not renumber placeholder-like text inside strings or comments during optional condition compression', async () => {
    const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
    const beforeNames = Array.from({ length: 9 }, (_, index) => `p${String(index + 1).padStart(2, '0')}`);
    const beforeSource = beforeNames.map((name) => `a.${name} = :${name}`).join(' and ');
    const beforeCompiled = beforeNames.map((name, index) => `a.${name} = $${index + 1}`).join(' and ');
    const sourceSql = `select '$12 is literal' as note from users a where ${beforeSource} and (:status is null or a.status = :status) and a.email = :email -- $13 is a comment`;
    const compiledSql = `select '$12 is literal' as note from users a where ${beforeCompiled} and ($10 is null or a.status = $11) and a.email = $12 -- $13 is a comment`;
    const client: NodePostgresQueryable = {
      async query(sql, values) {
        calls.push({ sql, values });
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client);

    await adapter.execute(querySource(sourceSql, queryModelFor(sourceSql, {
          sql: compiledSql,
          orderedNames: [...beforeNames, 'status', 'status', 'email'],
          optionalConditionCompression: optionalCompressionBinding(compiledSql, 'status', 'and ($10 is null or a.status = $11)'),
        }, {
          optionalConditionCompression: optionalCompressionAnalysis(sourceSql, 'status', 'and (:status is null or a.status = :status)'),
        })),
      Object.fromEntries([
        ...beforeNames.map((name, index) => [name, index + 1] as const),
        ['status', null] as const,
        ['email', 'safe@example.test'] as const,
      ]),{
        optionalConditionCompression: true},
    );

    expect(calls).toEqual([{
      sql: `select '$12 is literal' as note from users a where ${beforeCompiled}  and a.email = $10 -- $13 is a comment`,
      values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 'safe@example.test'],
    }]);
  });

  test('ignores placeholder-like text across Postgres lexical contexts during optional condition compression', async () => {
    const lexicalCases = [
      {
        label: 'escape string',
        sourcePrefix: "select E'\\\\$12 is literal' as note",
        compiledPrefix: "select E'\\\\$12 is literal' as note",
      },
      {
        label: 'double quoted identifier',
        sourcePrefix: 'select "$12_identifier" as note',
        compiledPrefix: 'select "$12_identifier" as note',
      },
      {
        label: 'dollar quoted string',
        sourcePrefix: 'select $$ $12 is literal $$ as note',
        compiledPrefix: 'select $$ $12 is literal $$ as note',
      },
      {
        label: 'tagged dollar quoted string',
        sourcePrefix: 'select $tag$ $12 is literal $tag$ as note',
        compiledPrefix: 'select $tag$ $12 is literal $tag$ as note',
      },
      {
        label: 'block comment',
        sourcePrefix: 'select 1 /* $12 is a comment */',
        compiledPrefix: 'select 1 /* $12 is a comment */',
      },
    ];

    for (const lexicalCase of lexicalCases) {
      const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
      const sourceSql = `${lexicalCase.sourcePrefix} from users a where a.p01 = :p01 and (:status is null or a.status = :status) and a.email = :email`;
      const compiledSql = `${lexicalCase.compiledPrefix} from users a where a.p01 = $1 and ($2 is null or a.status = $3) and a.email = $4`;
      const client: NodePostgresQueryable = {
        async query(sql, values) {
          calls.push({ sql, values });
          return { rows: [], rowCount: 0 };
        },
      };
      const adapter = createPostgresAdapter(client);

      await adapter.execute(querySource(sourceSql, queryModelFor(sourceSql, {
            sql: compiledSql,
            orderedNames: ['p01', 'status', 'status', 'email'],
            optionalConditionCompression: optionalCompressionBinding(compiledSql, 'status', 'and ($2 is null or a.status = $3)'),
          }, {
            optionalConditionCompression: optionalCompressionAnalysis(sourceSql, 'status', 'and (:status is null or a.status = :status)'),
          })),
        { p01: 1, status: null, email: `${lexicalCase.label}' or 1=1;--` },{
          optionalConditionCompression: true},
      );

      expect(calls, lexicalCase.label).toEqual([{
        sql: `${lexicalCase.compiledPrefix} from users a where a.p01 = $1  and a.email = $2`,
        values: [1, `${lexicalCase.label}' or 1=1;--`],
      }]);
    }
  });

  test('property: optional condition compression and safe sort keep SQL shape and bound values stable', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        beforeCount: fc.integer({ min: 1, max: 14 }),
        afterCount: fc.integer({ min: 0, max: 8 }),
        hasExistingOrderBy: fc.boolean(),
        direction: fc.constantFrom<'asc' | 'desc'>('asc', 'desc'),
      }),
      async ({ beforeCount, afterCount, hasExistingOrderBy, direction }) => {
        const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
        const beforeNames = Array.from({ length: beforeCount }, (_, index) => `p${String(index + 1).padStart(2, '0')}`);
        const afterNames = Array.from({ length: afterCount }, (_, index) => `q${String(index + 1).padStart(2, '0')}`);
        const selectSql = "select a.user_id as id, '$999 is literal' as note from users a";
        const beforeSource = beforeNames.map((name) => `a.${name} = :${name}`).join(' and ');
        const beforeCompiled = beforeNames.map((name, index) => `a.${name} = $${index + 1}`).join(' and ');
        const sourceBranch = 'and (:status is null or a.status = :status)';
        const compiledBranch = `and ($${beforeCount + 1} is null or a.status = $${beforeCount + 2})`;
        const afterSource = afterNames.length > 0
          ? ` and ${afterNames.map((name) => `a.${name} = :${name}`).join(' and ')}`
          : '';
        const afterCompiled = afterNames.length > 0
          ? ` and ${afterNames.map((name, index) => `a.${name} = $${beforeCount + 3 + index}`).join(' and ')}`
          : '';
        const afterRenumbered = afterNames.length > 0
          ? `  and ${afterNames.map((name, index) => `a.${name} = $${beforeCount + 1 + index}`).join(' and ')}`
          : '';
        const orderSource = hasExistingOrderBy ? ' order by a.created_at' : '';
        const sourceSql = `${selectSql} where ${beforeSource} ${sourceBranch}${afterSource}${orderSource}`;
        const compiledSql = `${selectSql} where ${beforeCompiled} ${compiledBranch}${afterCompiled}${orderSource}`;
        const client: NodePostgresQueryable = {
          async query(sql, values) {
            calls.push({ sql, values });
            return { rows: [], rowCount: 0 };
          },
        };
        const adapter = createPostgresAdapter(client);
        const paramEntries = [
          ...beforeNames.map((name, index) => [name, `before-${index + 1}' ; drop table before;--`] as const),
          ['status', null] as const,
          ...afterNames.map((name, index) => [name, `after-${index + 1}' ; drop table after;--`] as const),
        ];

        await adapter.execute(querySource(sourceSql, queryModelFor(sourceSql, {
              sql: compiledSql,
              orderedNames: [...beforeNames, 'status', 'status', ...afterNames],
              safeSortInsertion: { index: compiledSql.length },
              optionalConditionCompression: optionalCompressionBinding(compiledSql, 'status', compiledBranch),
            }, {
              rootQueryShape: 'simple-select',
              safeSort: {
                insertion: {
                  status: 'ready',
                  index: sourceSql.length,
                  mode: hasExistingOrderBy ? 'comma' : 'order-by',
                },
                sortable: { id: { sql: 'a.user_id' } },
              },
              optionalConditionCompression: optionalCompressionAnalysis(sourceSql, 'status', sourceBranch),
            })),
          Object.fromEntries(paramEntries),{
            optionalConditionCompression: true,
            sort: [{ key: 'id', direction }]},
        );

        const compressedWhere = `${beforeCompiled}${afterRenumbered || (hasExistingOrderBy ? ' ' : '')}`;
        const expectedSql = hasExistingOrderBy
          ? `${selectSql} where ${compressedWhere} order by a.created_at, a.user_id ${direction}`
          : `${selectSql} where ${compressedWhere} order by a.user_id ${direction}`;
        const expectedValues = [
          ...beforeNames.map((_, index) => `before-${index + 1}' ; drop table before;--`),
          ...afterNames.map((_, index) => `after-${index + 1}' ; drop table after;--`),
        ];

        expect(calls).toEqual([{ sql: expectedSql, values: expectedValues }]);
        for (const value of expectedValues) {
          expect(calls[0]?.sql).not.toContain(value);
        }
      },
    ), { numRuns: 100 });
  });

  test('combines optional condition compression with mixed optional parameters and comma-mode safe sort', async () => {
    const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
    const sourceSql = 'select a.user_id as id from users a where a.tenant_id = :tenant_id and (:status is null or a.status = :status) and (:email is null or a.email = :email) order by a.created_at';
    const compiledSql = 'select a.user_id as id from users a where a.tenant_id = $1 and ($2 is null or a.status = $3) and ($4 is null or a.email = $5) order by a.created_at';
    const client: NodePostgresQueryable = {
      async query(sql, values) {
        calls.push({ sql, values });
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client);

    await adapter.execute(querySource(sourceSql, queryModelFor(sourceSql, {
          sql: compiledSql,
          orderedNames: ['tenant_id', 'status', 'status', 'email', 'email'],
          safeSortInsertion: { index: compiledSql.length },
          optionalConditionCompression: {
            branches: [
              ...optionalCompressionBinding(compiledSql, 'status', 'and ($2 is null or a.status = $3)').branches,
              ...optionalCompressionBinding(compiledSql, 'email', 'and ($4 is null or a.email = $5)').branches,
            ],
          },
        }, {
          rootQueryShape: 'simple-select',
          safeSort: {
            insertion: { status: 'ready', index: sourceSql.length, mode: 'comma' },
            sortable: { id: { sql: 'a.user_id' } },
          },
          optionalConditionCompression: {
            enabled: true,
            branches: [
              ...optionalCompressionAnalysis(sourceSql, 'status', 'and (:status is null or a.status = :status)').branches,
              ...optionalCompressionAnalysis(sourceSql, 'email', 'and (:email is null or a.email = :email)').branches,
            ],
          },
        })),
      { tenant_id: 7, status: null, email: 'a@example.test' },{
        optionalConditionCompression: true,
        sort: [{ key: 'id' }]},
    );

    expect(calls).toEqual([{
      sql: 'select a.user_id as id from users a where a.tenant_id = $1  and ($2 is null or a.email = $3) order by a.created_at, a.user_id asc',
      values: [7, 'a@example.test', 'a@example.test'],
    }]);
  });

  test('does not compress missing optional parameters as absent before parameter validation', async () => {
    let called = false;
    const sourceSql = 'select * from users where tenant_id = :tenant_id and (:status is null or status = :status)';
    const compiledSql = 'select * from users where tenant_id = $1 and ($2 is null or status = $3)';
    const client: NodePostgresQueryable = {
      async query() {
        called = true;
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client);

    await expect(adapter.execute(querySource(sourceSql, queryModelFor(sourceSql, {
          sql: compiledSql,
          orderedNames: ['tenant_id', 'status', 'status'],
          optionalConditionCompression: optionalCompressionBinding(compiledSql, 'status', 'and ($2 is null or status = $3)'),
        }, {
          optionalConditionCompression: optionalCompressionAnalysis(sourceSql, 'status', 'and (:status is null or status = :status)'),
        })),
      { tenant_id: 10 },{
        optionalConditionCompression: true},
    )).rejects.toMatchObject({
      code: 'ASHIBA_MISSING_PARAMETER',
      parameterNames: ['status'],
    });
    expect(called).toBe(false);
  });

  test('rejects stale optional condition compression range text before broken SQL can be emitted', async () => {
    let called = false;
    const sourceSql = 'select * from users where tenant_id = :tenant_id and (:status is null or status = :status)';
    const compiledSql = 'select * from users where tenant_id = $1 and ($2 is null or status = $3)';
    const staleBinding = optionalCompressionBinding(compiledSql, 'status', 'and ($2 is null or status = $3)');
    const client: NodePostgresQueryable = {
      async query() {
        called = true;
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client);

    await expect(adapter.execute(querySource(sourceSql, queryModelFor(sourceSql, {
          sql: compiledSql,
          orderedNames: ['tenant_id', 'status', 'status'],
          optionalConditionCompression: {
            branches: [{
              ...staleBinding.branches[0],
              removalRange: {
                ...staleBinding.branches[0]!.removalRange,
                text: 'and ($2 is null or hacked = $3)',
              },
            }],
          },
        }, {
          optionalConditionCompression: optionalCompressionAnalysis(sourceSql, 'status', 'and (:status is null or status = :status)'),
        })),
      { tenant_id: 10, status: null },{
        optionalConditionCompression: true},
    )).rejects.toMatchObject({
      code: 'ASHIBA_OPTIONAL_CONDITION_COMPRESSION_METADATA_STALE',
    });
    expect(called).toBe(false);
  });

  test('renders safe sort from query model sortable metadata without proprietary SQL markers', async () => {
    const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
    const sourceSql = 'select a.user_id as id from users a';
    const client: NodePostgresQueryable = {
      async query(sql, values) {
        calls.push({ sql, values });
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client);

    await adapter.execute(querySource(sourceSql, {
          analysis: {
            astParse: 'ok',
            statementKind: 'select',
            rootQueryShape: 'simple-select',
            hasTopLevelOrderBy: false,
            sourceHash: hashSql(sourceSql),
            safeSort: {
              insertion: { status: 'ready', index: sourceSql.length, mode: 'order-by' },
              sortable: { id: { sql: 'a.user_id' } },
            },
          },
          bindings: queryModelFor(sourceSql, {
            safeSortInsertion: { index: sourceSql.length },
          }).bindings,
        }),
      {},{
        sort: [{ key: 'id' }]},
    );

    expect(calls).toEqual([{ sql: 'select a.user_id as id from users a order by a.user_id asc', values: [] }]);
  });

  test('renders safe sort as comma when query already has ORDER BY', async () => {
    const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
    const sourceSql = 'select a.user_id as id from users a order by a.name';
    const client: NodePostgresQueryable = {
      async query(sql, values) {
        calls.push({ sql, values });
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client);

    await adapter.execute(querySource(sourceSql, {
          analysis: {
            astParse: 'ok',
            statementKind: 'select',
            rootQueryShape: 'simple-select',
            hasTopLevelOrderBy: false,
            sourceHash: hashSql(sourceSql),
            safeSort: {
              insertion: { status: 'ready', index: sourceSql.length, mode: 'comma' },
              sortable: { id: { sql: 'a.user_id' } },
            },
          },
          bindings: queryModelFor(sourceSql, {
            safeSortInsertion: { index: sourceSql.length },
          }).bindings,
        }),
      {},{
        sort: [{ key: 'id', direction: 'desc' }]},
    );

    expect(calls).toEqual([{ sql: 'select a.user_id as id from users a order by a.name, a.user_id desc', values: [] }]);
  });

  test('renders safe sort before LIMIT from query model insertion metadata', async () => {
    const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
    const sourceSql = 'select a.user_id as id from users a where a.status = :status limit :limit';
    const insertionIndex = sourceSql.indexOf('limit :limit');
    const compiledSql = 'select a.user_id as id from users a where a.status = $1 limit $2';
    const compiledInsertionIndex = compiledSql.indexOf('limit $2');
    const client: NodePostgresQueryable = {
      async query(sql, values) {
        calls.push({ sql, values });
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client);

    await adapter.execute(querySource(sourceSql, {
          analysis: {
            astParse: 'ok',
            statementKind: 'select',
            rootQueryShape: 'simple-select',
            hasTopLevelOrderBy: false,
            sourceHash: hashSql(sourceSql),
            safeSort: {
              insertion: { status: 'ready', index: insertionIndex, mode: 'order-by' },
              sortable: { id: { sql: 'a.user_id' } },
            },
          },
          bindings: queryModelFor(sourceSql, {
            sql: compiledSql,
            orderedNames: ['status', 'limit'],
            safeSortInsertion: { index: compiledInsertionIndex },
          }).bindings,
        }),
      { status: 'active', limit: 10 },{
        sort: [{ key: 'id', direction: 'desc' }]},
    );

    expect(calls).toEqual([{
      sql: 'select a.user_id as id from users a where a.status = $1 order by a.user_id desc limit $2',
      values: ['active', 10],
    }]);
  });

  test('renders safe sort before FOR UPDATE from query model insertion metadata', async () => {
    const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
    const sourceSql = 'select a.user_id as id from users a where a.user_id = :user_id for update';
    const insertionIndex = sourceSql.indexOf('for update');
    const compiledSql = 'select a.user_id as id from users a where a.user_id = $1 for update';
    const compiledInsertionIndex = compiledSql.indexOf('for update');
    const client: NodePostgresQueryable = {
      async query(sql, values) {
        calls.push({ sql, values });
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client);

    await adapter.execute(querySource(sourceSql, {
          analysis: {
            astParse: 'ok',
            statementKind: 'select',
            rootQueryShape: 'simple-select',
            hasTopLevelOrderBy: false,
            sourceHash: hashSql(sourceSql),
            safeSort: {
              insertion: { status: 'ready', index: insertionIndex, mode: 'order-by' },
              sortable: { id: { sql: 'a.user_id' } },
            },
          },
          bindings: queryModelFor(sourceSql, {
            sql: compiledSql,
            orderedNames: ['user_id'],
            safeSortInsertion: { index: compiledInsertionIndex },
          }).bindings,
        }),
      { user_id: 1 },{
        sort: [{ key: 'id' }]},
    );

    expect(calls).toEqual([{
      sql: 'select a.user_id as id from users a where a.user_id = $1 order by a.user_id asc for update',
      values: [1],
    }]);
  });

  test('rejects safe sort execution until insertion position is explicitly resolved', async () => {
    let called = false;
    const client: NodePostgresQueryable = {
      async query() {
        called = true;
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client);

    await expect(adapter.execute(querySource('select * from users', {
          analysis: {
            astParse: 'ok',
            statementKind: 'select',
            rootQueryShape: 'simple-select',
            hasTopLevelOrderBy: false,
            sourceHash: hashSql('select * from users'),
            safeSort: { insertion: { status: 'unresolved' } },
          },
        }),
      {},{
        sortProfile: {
          createdAt: { sql: '"created_at"', defaultDirection: 'desc' },
        },
        sort: [{ key: 'createdAt' }]},
    )).rejects.toMatchObject({ code: 'ASHIBA_SORT_INSERTION_UNRESOLVED' });

    expect(called).toBe(false);
  });

  test('rejects safe sort when compiled insertion metadata is missing', async () => {
    let called = false;
    const sourceSql = 'select a.user_id as id from users a where a.user_id = :user_id';
    const client: NodePostgresQueryable = {
      async query() {
        called = true;
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client);

    await expect(adapter.execute(querySource(sourceSql, {
          analysis: {
            astParse: 'ok',
            statementKind: 'select',
            rootQueryShape: 'simple-select',
            hasTopLevelOrderBy: false,
            sourceHash: hashSql(sourceSql),
            safeSort: {
              insertion: { status: 'ready', index: sourceSql.length, mode: 'order-by' },
              sortable: { id: { sql: 'a.user_id' } },
            },
          },
          bindings: {
            postgres: {
              sourceHash: hashSql(sourceSql),
              sql: 'select a.user_id as id from users a where a.user_id = $1',
              orderedNames: ['user_id'],
            },
          },
        }),
      { user_id: 1 },{
        sort: [{ key: 'id' }]},
    )).rejects.toMatchObject({ code: 'ASHIBA_SORT_QUERY_MODEL_STALE' });

    expect(called).toBe(false);
  });

  test('rejects SQL-like sort key and direction before execution', async () => {
    let called = false;
    const sourceSql = 'select a.user_id as id from users a';
    const client: NodePostgresQueryable = {
      async query() {
        called = true;
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client);

    await expect(adapter.execute(querySource(sourceSql, queryModelFor(sourceSql, {
          sql: sourceSql,
          orderedNames: [],
          safeSortInsertion: { index: sourceSql.length },
        }, {
          rootQueryShape: 'simple-select',
          safeSort: {
            insertion: { status: 'ready', index: sourceSql.length, mode: 'order-by' },
            sortable: { id: { sql: 'a.user_id' } },
          },
        })),
      {},{
        sort: [{ key: 'id desc; drop table users;--' }]},
    )).rejects.toMatchObject({ code: 'ASHIBA_UNKNOWN_SORT_KEY' });

    await expect(adapter.execute(querySource(sourceSql, queryModelFor(sourceSql, {
          sql: sourceSql,
          orderedNames: [],
          safeSortInsertion: { index: sourceSql.length },
        }, {
          rootQueryShape: 'simple-select',
          safeSort: {
            insertion: { status: 'ready', index: sourceSql.length, mode: 'order-by' },
            sortable: { id: { sql: 'a.user_id' } },
          },
        })),
      {},{
        sort: [{ key: 'id', direction: 'desc; drop table users;--' as 'desc' }]},
    )).rejects.toMatchObject({ code: 'ASHIBA_INVALID_SORT_DIRECTION' });

    expect(called).toBe(false);
  });

  test('includes query model guidance when safe sort insertion is unresolved', async () => {
    let called = false;
    const client: NodePostgresQueryable = {
      async query() {
        called = true;
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client);
    const sourceSql = 'select user_id as id from active_users union all select user_id as id from archived_users';

    await expect(adapter.execute(querySource(sourceSql, {
          analysis: {
            astParse: 'ok',
            statementKind: 'select',
            rootQueryShape: 'compound-select',
            hasTopLevelOrderBy: false,
            sourceHash: hashSql(sourceSql),
            safeSort: {
              insertion: {
                status: 'unresolved',
                reason: 'Root compound SELECT safe sort is not supported. Wrap the compound query in a subquery and expose stable sortable columns.',
              },
            },
          },
        }),
      {},{
        sortProfile: {
          id: { sql: 'id' },
        },
        sort: [{ key: 'id' }]},
    )).rejects.toMatchObject({
      code: 'ASHIBA_SORT_UNSUPPORTED_QUERY_MODEL',
      message: expect.stringContaining('Wrap the compound query in a subquery'),
    });

    expect(called).toBe(false);
  });

  test('validates safe sort profile before execution', async () => {
    let called = false;
    const sourceSql = 'select * from users;';
    const client: NodePostgresQueryable = {
      async query() {
        called = true;
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client);

    await expect(adapter.execute(querySource(sourceSql, {
          analysis: {
            astParse: 'ok',
            statementKind: 'select',
            hasTopLevelOrderBy: false,
            sourceHash: hashSql(sourceSql),
            safeSort: {
              insertion: { status: 'ready', index: sourceSql.length - 1, mode: 'order-by' },
              sortable: { createdAt: { sql: '"created_at"', defaultDirection: 'desc' } },
            },
          },
        }),
      {},{
        sort: [{ key: 'missing' }]},
    )).rejects.toMatchObject({ code: 'ASHIBA_UNKNOWN_SORT_KEY' });

    expect(called).toBe(false);
  });

  test('rejects explicit sort profile SQL outside query model sortable metadata', async () => {
    let called = false;
    const sourceSql = 'select a.user_id as id from users a';
    const client: NodePostgresQueryable = {
      async query() {
        called = true;
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client);

    await expect(adapter.execute(querySource(sourceSql, {
          analysis: {
            astParse: 'ok',
            statementKind: 'select',
            rootQueryShape: 'simple-select',
            hasTopLevelOrderBy: false,
            sourceHash: hashSql(sourceSql),
            safeSort: {
              insertion: { status: 'ready', index: sourceSql.length, mode: 'order-by' },
              sortable: { id: { sql: 'a.user_id' } },
            },
          },
        }),
      {},{
        sortProfile: {
          id: { sql: 'random()' },
        },
        sort: [{ key: 'id' }]},
    )).rejects.toMatchObject({ code: 'ASHIBA_SORT_PROFILE_OUTSIDE_QUERY_MODEL' });

    expect(called).toBe(false);
  });

  test('rejects safe sort when query model source hash does not match SQL', async () => {
    let called = false;
    const client: NodePostgresQueryable = {
      async query() {
        called = true;
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client);

    await expect(adapter.execute(querySource('select * from users', {
          analysis: {
            astParse: 'ok',
            statementKind: 'select',
            hasTopLevelOrderBy: false,
            sourceHash: hashSql('select * from other_users'),
            safeSort: { insertion: { status: 'unresolved' } },
          },
        }),
      {},{
        sortProfile: {
          createdAt: { sql: '"created_at"', defaultDirection: 'desc' },
        },
        sort: [{ key: 'createdAt' }]},
    )).rejects.toMatchObject({ code: 'ASHIBA_SORT_QUERY_MODEL_STALE' });

    expect(called).toBe(false);
  });

  test('rejects sort input without CLI-generated query model analysis', async () => {
    const client: NodePostgresQueryable = {
      async query() {
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client);

    await expect(adapter.execute(
      querySource('select * from users order by created_at desc', {} as AshibaPostgresQueryModel),
      {},
      {
        sortProfile: {
          createdAt: { sql: '"created_at"', defaultDirection: 'desc' },
        },
        sort: [{ key: 'createdAt' }],
      },
    )).rejects.toMatchObject({ code: 'ASHIBA_SORT_QUERY_MODEL_REQUIRED' });
  });

  test('rejects safe sort when query model parse failed', async () => {
    const client: NodePostgresQueryable = {
      async query() {
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client);

    await expect(adapter.execute(querySource('select * from users', {
          analysis: { astParse: 'failed', statementKind: 'unknown', hasTopLevelOrderBy: false },
        }),
      {},{
        sortProfile: {
          createdAt: { sql: '"created_at"', defaultDirection: 'desc' },
        },
        sort: [{ key: 'createdAt' }]},
    )).rejects.toMatchObject({ code: 'ASHIBA_SORT_UNSUPPORTED_QUERY_MODEL' });
  });

  test('rejects safe sort when query model is not a SELECT', async () => {
    const client: NodePostgresQueryable = {
      async query() {
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client);

    await expect(adapter.execute(querySource('update users set name = :name', {
          analysis: { astParse: 'ok', statementKind: 'update', hasTopLevelOrderBy: false },
        }),
      {},{
        sortProfile: {
          createdAt: { sql: '"created_at"', defaultDirection: 'desc' },
        },
        sort: [{ key: 'createdAt' }]},
    )).rejects.toThrow(AshibaSortError);
  });

  test('emits error events from pg compatible failures', async () => {
    const events: AshibaSqlExecutionEvent[] = [];
    const client: NodePostgresQueryable = {
      async query() {
        const error = new Error('relation does not exist') as Error & { code: string };
        error.code = '42P01';
        throw error;
      },
    };
    const adapter = createPostgresAdapter(client, {
      observer: {
        emit(event) {
          events.push(event);
        },
      },
      includeUnmaskedParamsInEvents: true,
      maskPolicy: 'never',
    });

    const sourceSql = 'select * from missing where id = :id';
    await expect(adapter.execute(querySource(sourceSql, queryModelFor(sourceSql, {
        sql: 'select * from missing where id = $1',
        orderedNames: ['id'],
      })), { id: 1 },{})).rejects.toThrow('relation does not exist');

    expect(events.map((event) => event.phase)).toEqual(['start', 'error']);
    expect(events[1]?.error).toMatchObject({ message: 'relation does not exist', code: '42P01' });
    expect(events[1]?.params).toEqual([1]);
    expect(events[1]?.maskedParams).toEqual([1]);
  });

  test('rejects unused parameters before calling the driver', async () => {
    let called = false;
    const client: NodePostgresQueryable = {
      async query() {
        called = true;
        return { rows: [], rowCount: 0 };
      },
    };
    const adapter = createPostgresAdapter(client);

    await expect(adapter.execute(querySource('select :id', queryModelFor('select :id', {
        sql: 'select $1',
        orderedNames: ['id'],
      })), { id: 1, unused: true },{})).rejects.toThrow(AshibaParameterError);
    expect(called).toBe(false);
  });
});

function hashSql(sql: string): string {
  return `sha256:${createHash('sha256').update(sql).digest('hex')}`;
}

function querySource(sourceSql: string, queryModel: AshibaPostgresQueryModel = queryModelFor(sourceSql)) {
  return {
    sql: sourceSql,
    sqlPath: 'queries/test.sql',
    queryModel,
  };
}

function queryModelFor(
  sourceSql: string,
  binding: {
    sql?: string;
    orderedNames?: readonly string[];
    safeSortInsertion?: { index: number };
    optionalConditionCompression?: {
      branches: readonly {
        parameterName: string;
          removalRange: {
            start: number;
            end: number;
            text?: string;
          };
        }[];
      };
  } = {},
  analysis: Record<string, unknown> = {},
) {
  return {
    analysis: {
      astParse: 'ok',
      statementKind: 'select',
      hasTopLevelOrderBy: false,
      sourceHash: hashSql(sourceSql),
      ...analysis,
    },
    bindings: {
      postgres: {
        sourceHash: hashSql(sourceSql),
        sql: binding.sql ?? sourceSql,
        orderedNames: binding.orderedNames ?? [],
        ...(binding.safeSortInsertion ? { safeSortInsertion: binding.safeSortInsertion } : {}),
        ...(binding.optionalConditionCompression ? { optionalConditionCompression: binding.optionalConditionCompression } : {}),
      },
    },
  };
}

function optionalCompressionAnalysis(sourceSql: string, parameterName: string, removalText: string) {
  const removalStart = sourceSql.indexOf(removalText);
  if (removalStart < 0) throw new Error(`Missing source removal text: ${removalText}`);
  const sourceText = removalText.replace(/^and\s+/i, '');
  const sourceStart = sourceSql.indexOf(sourceText, removalStart);
  return {
    enabled: true,
    branches: [{
      parameterName,
      kind: 'expression',
      sourceRange: {
        start: sourceStart,
        end: sourceStart + sourceText.length,
        text: sourceText,
      },
      removalRange: {
        start: removalStart,
        end: removalStart + removalText.length,
        text: removalText,
      },
    }],
  };
}

function optionalCompressionBinding(compiledSql: string, parameterName: string, removalText: string) {
  const removalStart = compiledSql.indexOf(removalText);
  if (removalStart < 0) throw new Error(`Missing compiled removal text: ${removalText}`);
  return {
    branches: [{
      parameterName,
      removalRange: {
        start: removalStart,
        end: removalStart + removalText.length,
        text: removalText,
      },
    }],
  };
}
