<div v-pre>
# Type Alias: AshibaSqlExecutionEvent

> **AshibaSqlExecutionEvent** = `object`

Defined in: [packages/driver-adapter-core/src/index.ts:20](https://github.com/mk3008/ashiba/blob/d8e0689dd98d1e26eee6579c94113531307b8c2a/packages/driver-adapter-core/src/index.ts#L20)

Structured event emitted by thin driver adapters around SQL execution.

## Properties

### phase

> **phase**: `"start"` \| `"end"` \| `"error"`

Defined in: [packages/driver-adapter-core/src/index.ts:21](https://github.com/mk3008/ashiba/blob/d8e0689dd98d1e26eee6579c94113531307b8c2a/packages/driver-adapter-core/src/index.ts#L21)

***

### metadata?

> `optional` **metadata?**: [`AshibaSqlExecutionMetadata`](AshibaSqlExecutionMetadata.md)

Defined in: [packages/driver-adapter-core/src/index.ts:22](https://github.com/mk3008/ashiba/blob/d8e0689dd98d1e26eee6579c94113531307b8c2a/packages/driver-adapter-core/src/index.ts#L22)

***

### warnings?

> `optional` **warnings?**: readonly `object`[]

Defined in: [packages/driver-adapter-core/src/index.ts:23](https://github.com/mk3008/ashiba/blob/d8e0689dd98d1e26eee6579c94113531307b8c2a/packages/driver-adapter-core/src/index.ts#L23)

***

### sourceSql?

> `optional` **sourceSql?**: `string`

Defined in: [packages/driver-adapter-core/src/index.ts:28](https://github.com/mk3008/ashiba/blob/d8e0689dd98d1e26eee6579c94113531307b8c2a/packages/driver-adapter-core/src/index.ts#L28)

***

### compiledSql?

> `optional` **compiledSql?**: `string`

Defined in: [packages/driver-adapter-core/src/index.ts:29](https://github.com/mk3008/ashiba/blob/d8e0689dd98d1e26eee6579c94113531307b8c2a/packages/driver-adapter-core/src/index.ts#L29)

***

### orderedNames?

> `optional` **orderedNames?**: readonly `string`[]

Defined in: [packages/driver-adapter-core/src/index.ts:30](https://github.com/mk3008/ashiba/blob/d8e0689dd98d1e26eee6579c94113531307b8c2a/packages/driver-adapter-core/src/index.ts#L30)

***

### maskedParams?

> `optional` **maskedParams?**: readonly `unknown`[]

Defined in: [packages/driver-adapter-core/src/index.ts:31](https://github.com/mk3008/ashiba/blob/d8e0689dd98d1e26eee6579c94113531307b8c2a/packages/driver-adapter-core/src/index.ts#L31)

***

### params?

> `optional` **params?**: readonly `unknown`[]

Defined in: [packages/driver-adapter-core/src/index.ts:32](https://github.com/mk3008/ashiba/blob/d8e0689dd98d1e26eee6579c94113531307b8c2a/packages/driver-adapter-core/src/index.ts#L32)

***

### elapsedMs?

> `optional` **elapsedMs?**: `number`

Defined in: [packages/driver-adapter-core/src/index.ts:33](https://github.com/mk3008/ashiba/blob/d8e0689dd98d1e26eee6579c94113531307b8c2a/packages/driver-adapter-core/src/index.ts#L33)

***

### rowCount?

> `optional` **rowCount?**: `number`

Defined in: [packages/driver-adapter-core/src/index.ts:34](https://github.com/mk3008/ashiba/blob/d8e0689dd98d1e26eee6579c94113531307b8c2a/packages/driver-adapter-core/src/index.ts#L34)

***

### error?

> `optional` **error?**: `object`

Defined in: [packages/driver-adapter-core/src/index.ts:35](https://github.com/mk3008/ashiba/blob/d8e0689dd98d1e26eee6579c94113531307b8c2a/packages/driver-adapter-core/src/index.ts#L35)

#### name

> **name**: `string`

#### message

> **message**: `string`

#### code?

> `optional` **code?**: `string`

#### cause?

> `optional` **cause?**: `string`

#### nextAction?

> `optional` **nextAction?**: `string`
</div>
