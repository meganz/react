
## Input

```javascript
// @enablePropagateDepsInHIR
const {throwInput} = require('shared-runtime');

function Component(props) {
  let x;
  try {
    const y = [];
    y.push(props.y);
    throwInput(y);
  } catch (e) {
    e.push(props.e);
    x = e;
  }
  return x;
}

export const FIXTURE_ENTRYPOINT = {
  fn: Component,
  params: [{y: 'foo', e: 'bar'}],
};

```

## Code

```javascript
import { c as _c } from "react/compiler-runtime"; // @enablePropagateDepsInHIR
const { throwInput } = require("shared-runtime");

function Component(props) {
  const $ = _c(2);
  let x;
  if ($[0] !== props) {
    try {
      const y = [];
      y.push(props.y);
      throwInput(y);
    } catch (t0) {
      const e = t0;
      e.push(props.e);
      x = e;
    }
    $[0] = props;
    $[1] = x;
  } else {
    x = $[1];
  }
  return x;
}

export const FIXTURE_ENTRYPOINT = {
  fn: Component,
  params: [{ y: "foo", e: "bar" }],
};

```
      
### Eval output
(kind: ok) ["foo","bar"]