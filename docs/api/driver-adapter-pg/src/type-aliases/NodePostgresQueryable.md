<div v-pre>
# Type Alias: NodePostgresQueryable&lt;Row\&gt;

> **NodePostgresQueryable**&lt;`Row`\&gt; = `object`

Defined in: [packages/driver-adapter-pg/src/index.ts:26](https://github.com/mk3008/ashiba/blob/192cdfcf1e45b1db0624095e93d8f21bbd266ddb/packages/driver-adapter-pg/src/index.ts#L26)

Minimal pg-compatible client or pool contract.

## Type Parameters

### Row

`Row` = `unknown`

## Methods

### query()

> **query**(`sql`, `values`): `Promise`&lt;[`NodePostgresQueryResult`](NodePostgresQueryResult.md)\<`Row`\&gt;\>

Defined in: [packages/driver-adapter-pg/src/index.ts:27](https://github.com/mk3008/ashiba/blob/192cdfcf1e45b1db0624095e93d8f21bbd266ddb/packages/driver-adapter-pg/src/index.ts#L27)

#### Parameters

##### sql

`string`

##### values

readonly `unknown`[]

#### Returns

`Promise`&lt;[`NodePostgresQueryResult`](NodePostgresQueryResult.md)\<`Row`\&gt;\>
</div>
