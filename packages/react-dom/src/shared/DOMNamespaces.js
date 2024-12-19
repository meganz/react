/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
export const MATH_NAMESPACE = 'http://www.w3.org/1998/Math/MathML';
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

// Assumes there is no parent namespace.
export function getIntrinsicNamespace(type: string): string {
  return HTML_NAMESPACE;
}

export function getChildNamespace(
  parentNamespace: string | null,
  type: string,
): string {
  return HTML_NAMESPACE;
}
