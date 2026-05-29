<div v-pre>
# Type Alias: AshibaPostgresAdapter

> **AshibaPostgresAdapter** = `object`

Defined in: [packages/driver-adapter-pg/src/index.ts:89](https://github.com/mk3008/ashiba/blob/192cdfcf1e45b1db0624095e93d8f21bbd266ddb/packages/driver-adapter-pg/src/index.ts#L89)

Thin PostgreSQL adapter interface exposed to application code.

## Methods

### execute()

> **execute**&lt;`Row`\&gt;(`query`, `params?`, `options?`): `Promise`&lt;[`NodePostgresQueryResult`](NodePostgresQueryResult.md)\<`Row`\&gt;\>

Defined in: [packages/driver-adapter-pg/src/index.ts:90](https://github.com/mk3008/ashiba/blob/192cdfcf1e45b1db0624095e93d8f21bbd266ddb/packages/driver-adapter-pg/src/index.ts#L90)

#### Type Parameters

##### Row

`Row` = `unknown`

#### Parameters

##### query

[`AshibaPostgresQuerySource`](AshibaPostgresQuerySource.md)

##### params?

`Readonly`&lt;`Record`\<`string`, `unknown`\&gt;\>

##### options?

[`AshibaPostgresExecuteOptions`](AshibaPostgresExecuteOptions.md)

#### Returns

`Promise`&lt;[`NodePostgresQueryResult`](NodePostgresQueryResult.md)\<`Row`\&gt;\>
</div>
