import { button, labelStrip, type ButtonVariant } from './kit/kit';

/** Small DOM helpers for the menu screens, which are built from the UI kit over the theatre. */

export function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent?: HTMLElement,
  testId?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = className;
  if (testId) n.dataset.testid = testId;
  if (text !== undefined) n.textContent = text;
  parent?.appendChild(n);
  return n;
}

/** A scene's root: fills the overlay, lets clicks through except on its controls. */
export function sceneRoot(testId: string, className: string): HTMLElement {
  const n = node('div', `scene menu ${className}`);
  n.dataset.testid = testId;
  return n;
}

/** The block of lettering written on the hanging sign. */
export function signContent(parent: HTMLElement, className = ''): HTMLElement {
  return node('div', `sign-content ${className}`.trim(), parent);
}

/** The typed line of paper under the sign's title ("a sock puppet duel for two"). */
export function tagline(text: string, testId?: string): HTMLElement {
  return node('span', 'sign-tagline', undefined, testId, text);
}

/** A marker-on-tape remark. */
export function quip(text: string, rotate = 2): HTMLElement {
  const n = node('span', 'sign-quip', undefined, undefined, text);
  n.style.setProperty('--rot', `${rotate}deg`);
  return n;
}

/** A button of the kit, in the menu's size for its place. */
export function menuButton(
  label: string,
  testId: string,
  variant: ButtonVariant,
  onClick: () => void,
  size: 'main' | 'side' | 'sign' = 'side',
): HTMLButtonElement {
  const b = button(label, { variant, testId, onClick });
  b.classList.add(`mb-${size}`);
  return b;
}

/** Black label over a value, as on the ledge in the lobby ("YOUR NAME", "YOUR FRIEND"). */
export function captioned(caption: string, align: 'left' | 'right'): { root: HTMLElement; row: HTMLElement } {
  const root = node('div', `captioned captioned-${align}`);
  root.appendChild(labelStrip(caption));
  const row = node('div', 'captioned-row', root);
  return { root, row };
}
