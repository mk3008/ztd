<div v-pre>
# Type Alias: AshibaMssqlAdapter

> **AshibaMssqlAdapter** = `object`

Defined in: [packages/driver-adapter-mssql/src/index.ts:70](https://github.com/mk3008/ashiba/blob/d8e0689dd98d1e26eee6579c94113531307b8c2a/packages/driver-adapter-mssql/src/index.ts#L70)

Thin mssql adapter interface exposed to application code.

## Methods

### execute()

> **execute**&lt;`Row`\&gt;(`query`, `params?`): `Promise`&lt;[`MssqlQueryResult`](MssqlQueryResult.md)\<`Row`\&gt;\>

Defined in: [packages/driver-adapter-mssql/src/index.ts:71](https://github.com/mk3008/ashiba/blob/d8e0689dd98d1e26eee6579c94113531307b8c2a/packages/driver-adapter-mssql/src/index.ts#L71)

#### Type Parameters

##### Row

`Row` = `unknown`

#### Parameters

##### query

[`AshibaMssqlQuerySource`](AshibaMssqlQuerySource.md)

##### params?

`Readonly`&lt;`Record`\<`string`, `unknown`\&gt;\>

#### Returns

`Promise`&lt;[`MssqlQueryResult`](MssqlQueryResult.md)\<`Row`\&gt;\>
</div>
