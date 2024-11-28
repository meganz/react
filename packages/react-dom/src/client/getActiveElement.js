/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

export default function getActiveElement(doc: ?Document): ?Element {
  doc = doc || document;
  try {
    return doc.activeElement || doc.body;
  } catch (e) {
    return doc.body;
  }
}
