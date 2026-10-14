// JavaScript que roda DENTRO da página aberta pelo navegador dos Pipos. Fica como texto (e não como
// função TypeScript) para chegar à página exatamente como está escrito aqui, sem passar pelo bundler.

/** Biblioteca: acha elementos por número (do retrato da página), seletor CSS ou texto visível. */
const LIB = String.raw`
(() => {
  if (window.__pipoWeb) return;
  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const labelOf = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria) return clean(aria);
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = clean(by.split(/\s+/).map((id) => (document.getElementById(id) || {}).innerText || '').join(' '));
      if (t) return t;
    }
    const tag = el.tagName.toLowerCase();
    const field = tag === 'input' || tag === 'textarea' || tag === 'select';
    if (field && el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l && clean(l.innerText)) return clean(l.innerText);
    }
    if (field) {
      const wrap = el.closest('label');
      if (wrap && clean(wrap.innerText)) return clean(wrap.innerText);
      if (el.type === 'submit' || el.type === 'button' || el.type === 'reset') return clean(el.value);
      return clean(el.placeholder || el.name || el.title);
    }
    const img = el.querySelector('img[alt]');
    return clean(el.innerText || el.value || el.title || el.getAttribute('alt') || (img && img.getAttribute('alt')));
  };
  const INTERACTIVE = 'a[href], button, input:not([type=hidden]), textarea, select, summary, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=radio], [role=option], [contenteditable=""], [contenteditable=true]';
  const tryCss = (sel) => {
    try {
      return document.querySelector(sel);
    } catch (e) {
      return null;
    }
  };
  const byText = (txt) => {
    const want = clean(txt).toLowerCase();
    if (!want) return null;
    const els = Array.from(document.querySelectorAll(INTERACTIVE)).filter(visible);
    return els.find((e) => labelOf(e).toLowerCase() === want) || els.find((e) => labelOf(e).toLowerCase().includes(want)) || null;
  };
  const find = (target) => {
    const t = String(target).trim();
    if (/^\d+$/.test(t)) return document.querySelector('[data-pipo-ref="' + t + '"]');
    const m = /^(css|text|texto)=([\s\S]*)$/.exec(t);
    if (m) return m[1] === 'css' ? tryCss(m[2]) : byText(m[2]);
    return tryCss(t) || byText(t);
  };
  const roleOf = (el) => {
    const tag = el.tagName.toLowerCase();
    return el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'input' ? el.type || 'text' : tag);
  };
  const missing = (target) => ({ ok: false, error: 'Não achei "' + String(target).slice(0, 80) + '" na página.' });
  const mainText = () => clean2((document.querySelector('main, article, [role=main]') || document.body || {}).innerText || '');
  const clean2 = (s) => String(s).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  window.__pipoWeb = {
    snapshot(maxElements) {
      document.querySelectorAll('[data-pipo-ref]').forEach((e) => e.removeAttribute('data-pipo-ref'));
      const all = Array.from(document.querySelectorAll(INTERACTIVE)).filter(visible);
      const elements = all.slice(0, maxElements).map((el, i) => {
        el.setAttribute('data-pipo-ref', String(i + 1));
        const tag = el.tagName.toLowerCase();
        const secret = el.type === 'password';
        return {
          ref: i + 1,
          role: roleOf(el),
          name: labelOf(el).slice(0, 90),
          value: !secret && (tag === 'input' || tag === 'textarea' || tag === 'select') && el.type !== 'submit' && el.type !== 'button' && el.value ? String(el.value).slice(0, 80) : undefined,
          href: tag === 'a' && /^https?:/.test(el.href) ? el.href : undefined,
        };
      });
      return { url: location.href, title: document.title, text: mainText(), elements, more: Math.max(0, all.length - elements.length) };
    },
    info(target) {
      const el = find(target);
      if (!el) return null;
      const tag = el.tagName.toLowerCase();
      return {
        role: roleOf(el),
        name: labelOf(el).slice(0, 90),
        href: tag === 'a' && /^https?:/.test(el.href) && !el.getAttribute('onclick') ? el.href : null,
        password: el.type === 'password',
        field: tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable,
      };
    },
    click(target) {
      const el = find(target);
      if (!el) return missing(target);
      el.scrollIntoView({ block: 'center' });
      el.click();
      return { ok: true };
    },
    fill(target, value) {
      const el = find(target);
      if (!el) return missing(target);
      el.scrollIntoView({ block: 'center' });
      el.focus();
      const tag = el.tagName.toLowerCase();
      const v = String(value);
      if (tag === 'select') {
        const opt = Array.from(el.options).find((o) => clean(o.text).toLowerCase() === clean(v).toLowerCase() || o.value === v);
        if (!opt) return { ok: false, error: 'A opção "' + v.slice(0, 60) + '" não existe nessa lista.' };
        el.value = opt.value;
      } else if (el.type === 'checkbox' || el.type === 'radio') {
        if (el.checked !== /^(1|true|sim|on|yes)$/i.test(v)) el.click();
        return { ok: true };
      } else if (el.isContentEditable) {
        el.textContent = v;
      } else if (tag === 'input' || tag === 'textarea') {
        const proto = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      } else {
        return { ok: false, error: 'Isso não é um campo de preencher.' };
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    },
    /** Envia o formulário do campo (ou do campo com foco), como apertar Enter nele. */
    submit(target) {
      const el = target ? find(target) : document.activeElement;
      if (!el) return missing(target);
      const form = el.form || el.closest('form');
      if (!form) return { ok: false, error: 'Esse campo não está num formulário.' };
      if (form.requestSubmit) form.requestSubmit();
      else form.submit();
      return { ok: true };
    },
    text(target) {
      if (!target) return { ok: true, value: mainText() };
      const el = find(target);
      return el ? { ok: true, value: clean2(el.innerText || el.value || '') } : missing(target);
    },
    list(selector, attr) {
      let els;
      try {
        els = Array.from(document.querySelectorAll(selector));
      } catch (e) {
        return { ok: false, error: 'Seletor inválido: ' + selector };
      }
      return { ok: true, value: els.slice(0, 500).map((e) => (attr ? (attr === 'href' || attr === 'src' ? e[attr] : e.getAttribute(attr)) || '' : clean(e.innerText))) };
    },
    has(target) {
      const el = find(target);
      return !!el && visible(el);
    },
  };
})();
`;

/** Monta a chamada: injeta a biblioteca (se ainda não está na página) e roda um método dela. */
export function pageCall(method: string, ...args: unknown[]): string {
  return `${LIB}\nwindow.__pipoWeb.${method}(${args.map((a) => JSON.stringify(a ?? null)).join(', ')})`;
}
