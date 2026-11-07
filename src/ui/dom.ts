export function element<Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  attributes: Record<string, string> = {},
  content?: string,
): HTMLElementTagNameMap[Tag] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (content !== undefined) node.textContent = content;
  return node;
}

export function field(form: HTMLFormElement, name: string): HTMLInputElement {
  const input = form.elements.namedItem(name);
  if (!(input instanceof HTMLInputElement)) throw new Error('Missing form field.');
  return input;
}

export function section(title: string): HTMLElement {
  const node = element('section');
  node.append(element('h2', {}, title));
  return node;
}

export function input(options: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
}): HTMLLabelElement {
  const label = element('label', {}, options.label);
  const control = element('input', {
    name: options.name,
    type: options.type ?? 'text',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  if (options.required !== false) control.required = true;
  label.append(control);
  return label;
}
