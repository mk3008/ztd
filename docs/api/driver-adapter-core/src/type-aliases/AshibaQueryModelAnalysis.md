<div v-pre>
# Type Alias: AshibaQueryModelAnalysis

> **AshibaQueryModelAnalysis** = `object`

Defined in: [packages/driver-adapter-core/src/index.ts:80](https://github.com/mk3008/ashiba/blob/d8e0689dd98d1e26eee6579c94113531307b8c2a/packages/driver-adapter-core/src/index.ts#L80)

CLI-generated query metadata used by runtime adapters without parsing SQL at runtime.

## Properties

### astParse

> **astParse**: `"ok"` \| `"failed"`

Defined in: [packages/driver-adapter-core/src/index.ts:81](https://github.com/mk3008/ashiba/blob/d8e0689dd98d1e26eee6579c94113531307b8c2a/packages/driver-adapter-core/src/index.ts#L81)

***

### statementKind

> **statementKind**: `"select"` \| `"insert"` \| `"update"` \| `"delete"` \| `"unknown"`

Defined in: [packages/driver-adapter-core/src/index.ts:82](https://github.com/mk3008/ashiba/blob/d8e0689dd98d1e26eee6579c94113531307b8c2a/packages/driver-adapter-core/src/index.ts#L82)

***

### rootQueryShape?

> `optional` **rootQueryShape?**: `"simple-select"` \| `"compound-select"` \| `"values"` \| `"non-select"` \| `"unknown"`

Defined in: [packages/driver-adapter-core/src/index.ts:83](https://github.com/mk3008/ashiba/blob/d8e0689dd98d1e26eee6579c94113531307b8c2a/packages/driver-adapter-core/src/index.ts#L83)

***

### hasTopLevelOrderBy

> **hasTopLevelOrderBy**: `boolean`

Defined in: [packages/driver-adapter-core/src/index.ts:84](https://github.com/mk3008/ashiba/blob/d8e0689dd98d1e26eee6579c94113531307b8c2a/packages/driver-adapter-core/src/index.ts#L84)

***

### sourceHash?

> `optional` **sourceHash?**: `string`

Defined in: [packages/driver-adapter-core/src/index.ts:85](https://github.com/mk3008/ashiba/blob/d8e0689dd98d1e26eee6579c94113531307b8c2a/packages/driver-adapter-core/src/index.ts#L85)

***

### safeSort?

> `optional` **safeSort?**: `object`

Defined in: [packages/driver-adapter-core/src/index.ts:86](https://github.com/mk3008/ashiba/blob/d8e0689dd98d1e26eee6579c94113531307b8c2a/packages/driver-adapter-core/src/index.ts#L86)

#### insertion

> **insertion**: \{ `status`: `"ready"`; `index`: `number`; `mode`: `"order-by"` \| `"comma"`; \} \| \{ `status`: `"unresolved"`; `reason?`: `string`; \}

#### sortable?

> `optional` **sortable?**: `Readonly`&lt;`Record`\<`string`, [`AshibaSortProfileEntry`](AshibaSortProfileEntry.md)\&gt;\>

***

### optionalConditionCompression?

> `optional` **optionalConditionCompression?**: `object`

Defined in: [packages/driver-adapter-core/src/index.ts:99](https://github.com/mk3008/ashiba/blob/d8e0689dd98d1e26eee6579c94113531307b8c2a/packages/driver-adapter-core/src/index.ts#L99)

#### enabled

> **enabled**: `true`

#### branches

> **branches**: readonly `object`[]
</div>
