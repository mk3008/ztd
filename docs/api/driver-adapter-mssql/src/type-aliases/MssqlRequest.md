<div v-pre>
# Type Alias: MssqlRequest&lt;Row\&gt;

> **MssqlRequest**&lt;`Row`\&gt; = `object`

Defined in: [packages/driver-adapter-mssql/src/index.ts:22](https://github.com/mk3008/ashiba/blob/d8e0689dd98d1e26eee6579c94113531307b8c2a/packages/driver-adapter-mssql/src/index.ts#L22)

Minimal mssql-compatible request contract.

## Type Parameters

### Row

`Row` = `unknown`

## Methods

### input()

> **input**(`name`, `value`): `MssqlRequest`&lt;`Row`\&gt;

Defined in: [packages/driver-adapter-mssql/src/index.ts:23](https://github.com/mk3008/ashiba/blob/d8e0689dd98d1e26eee6579c94113531307b8c2a/packages/driver-adapter-mssql/src/index.ts#L23)

#### Parameters

##### name

`string`

##### value

`unknown`

#### Returns

`MssqlRequest`&lt;`Row`\&gt;

***

### query()

> **query**(`sql`): `Promise`&lt;[`MssqlQueryResult`](MssqlQueryResult.md)\<`Row`\&gt;\>

Defined in: [packages/driver-adapter-mssql/src/index.ts:24](https://github.com/mk3008/ashiba/blob/d8e0689dd98d1e26eee6579c94113531307b8c2a/packages/driver-adapter-mssql/src/index.ts#L24)

#### Parameters

##### sql

`string`

#### Returns

`Promise`&lt;[`MssqlQueryResult`](MssqlQueryResult.md)\<`Row`\&gt;\>
</div>
