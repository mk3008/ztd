<div v-pre>
# Function: normalizeError()

> **normalizeError**(`error`): `object`

Defined in: [packages/driver-adapter-core/src/index.ts:180](https://github.com/mk3008/ashiba/blob/192cdfcf1e45b1db0624095e93d8f21bbd266ddb/packages/driver-adapter-core/src/index.ts#L180)

Convert unknown thrown values into the structured error shape used by driver events.

## Parameters

### error

`unknown`

## Returns

`object`

### name

> **name**: `string`

### message

> **message**: `string`

### code?

> `optional` **code?**: `string`

### cause?

> `optional` **cause?**: `string`

### nextAction?

> `optional` **nextAction?**: `string`
</div>
