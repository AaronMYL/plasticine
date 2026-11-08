import Foundation
import WebKit

// 网页标签的 DOM 脚本（第 102 条第 3 批）。都在独立的脚本世界（.defaultClient）里跑：页面自己的脚本看不到、也改不了
// 这些函数，DOM 和事件是同一份。每个脚本都回一个 JSON 字符串，Swift 按下面的结构解码；密码框的值从不读出来。

struct TabLocateResult: Decodable {
    let found: Bool
    let error: String?
    let count: Int?
    let facts: TabTargetFacts?
    let tag: String?
    let text: String?
}

struct TabStateResult: Decodable {
    let url: String
    let title: String
    let state: String
}

struct TabFillResult: Decodable {
    let ok: Bool
    let error: String?
    let matches: Bool?
    let tag: String?
    let type: String?
}

struct TabPageText: Decodable {
    let url: String
    let title: String
    let text: String
}

@MainActor
enum WebTabDOM {
    // tab_read 的上限，和 agent/shared/api/node-channel.ts 一致。
    static let readTextChars = 12_000
    static let readLinks = 40
    static let readFields = 30
    static let linkTextChars = 80
    static let linkHrefChars = 300
    static let fieldValueChars = 200

    private static let helpers = """
        const clip = (s, n) => { const a = Array.from(String(s ?? '')); \
        return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join(''); };
        const visible = (el) => { if (el.getClientRects().length === 0) return false; \
        const st = getComputedStyle(el); return st.visibility !== 'hidden' && st.display !== 'none'; };
        const norm = (s) => String(s ?? '').replace(/\\s+/g, ' ').trim().toLowerCase();
        const textOf = (el) => el.innerText || el.value || el.getAttribute('aria-label') || el.title || '';
        const unique = (s) => { try { return document.querySelectorAll(s).length === 1; } catch (e) { return false; } };
        const selectorOf = (el) => {
          if (el.id && unique('#' + CSS.escape(el.id))) return '#' + CSS.escape(el.id);
          const tag = el.tagName.toLowerCase();
          const name = el.getAttribute('name');
          const byName = name ? tag + '[name="' + CSS.escape(name) + '"]' : null;
          if (byName && unique(byName)) return byName;
          const parts = [];
          for (let node = el; node && node.parentElement && node !== document.body; node = node.parentElement) {
            const same = Array.from(node.parentElement.children).filter((c) => c.tagName === node.tagName);
            const t = node.tagName.toLowerCase();
            parts.unshift(same.length > 1 ? t + ':nth-of-type(' + (same.indexOf(node) + 1) + ')' : t);
            if (node.id && unique('#' + CSS.escape(node.id))) { parts[0] = '#' + CSS.escape(node.id); break; }
          }
          return parts.join(' > ');
        };
        const labelOf = (el) => (el.labels && el.labels[0] ? el.labels[0].innerText : '') \
        || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.title || '';
        const marked = (nonce) => document.querySelector('[data-plasticine-target="' + nonce + '"]');
        """

    private static let read = helpers + """
        const text = Array.from(document.body ? document.body.innerText : '');
        const slice = text.slice(offset, offset + maxText).join('');
        const nextOffset = offset + maxText < text.length ? offset + maxText : null;
        const links = []; const fields = []; let linksTruncated = false; let fieldsTruncated = false;
        if (offset === 0) {
          for (const a of document.querySelectorAll('a[href]')) {
            if (!/^https?:/i.test(a.href) || !visible(a)) continue;
            if (links.length >= maxLinks) { linksTruncated = true; break; }
            links.push({ text: clip(textOf(a).trim(), linkText), href: clip(a.href, linkHref) });
          }
          const editable = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]';
          for (const el of document.querySelectorAll(editable)) {
            const type = (el.getAttribute('type') || '').toLowerCase();
            if (type === 'hidden' || !visible(el)) continue;
            if (fields.length >= maxFields) { fieldsTruncated = true; break; }
            const tag = el.tagName.toLowerCase();
            const rich = !('value' in el) && el.isContentEditable;
            const checkable = type === 'checkbox' || type === 'radio';
            const shown = type || (tag === 'input' ? 'text' : rich ? 'contenteditable' : tag);
            fields.push({ selector: clip(selectorOf(el), 200), tag, type: shown,
              name: clip(el.getAttribute('name') || '', 80), label: clip(labelOf(el), 80),
              value: type === 'password' ? null : clip(rich ? el.innerText : (el.value ?? ''), fieldValue),
              checked: checkable ? el.checked : null, disabled: !!el.disabled });
          }
        }
        return JSON.stringify({ url: location.href, title: document.title, text: slice, offset,
          totalChars: text.length, nextOffset, links, fields, linksTruncated, fieldsTruncated });
        """

    private static let locate = helpers + """
        let el = null; let count = 0;
        if (selector !== null) {
          let all;
          try { all = Array.from(document.querySelectorAll(selector)); }
          catch (e) { return JSON.stringify({ found: false, error: 'selector' }); }
          const shown = all.filter(visible);
          count = all.length; el = shown[0] || all[0] || null;
        } else {
          const clickable = 'a, button, input[type=button], input[type=submit], input[type=reset], input[type=image], '
            + 'summary, label, [role=button], [role=link], [role=menuitem], [role=tab], [role=option], [onclick]';
          const want = norm(text);
          const candidates = Array.from(document.querySelectorAll(clickable)).filter(visible);
          const exact = candidates.filter((c) => norm(textOf(c)) === want);
          const loose = exact.length > 0 ? exact : candidates.filter((c) => norm(textOf(c)).includes(want));
          count = loose.length; el = loose[0] || null;
        }
        if (!el) return JSON.stringify({ found: false, error: 'missing', count: 0 });
        el.setAttribute('data-plasticine-target', nonce);
        const form = el.form || el.closest('form');
        const type = (el.getAttribute('type') || '').toLowerCase();
        const isPassword = type === 'password';
        const label = clip([isPassword ? '' : textOf(el), el.getAttribute('aria-label'), el.title,
          el.getAttribute('name'), el.id].filter(Boolean).join(' '), 300);
        const facts = { pageUrl: location.href, label,
          name: [el.getAttribute('name'), el.id].filter(Boolean).join(' '),
          autocomplete: el.getAttribute('autocomplete') || '',
          formAction: form && form.getAttribute('action') ? form.action : '', isPassword,
          formHasPassword: !!(form && form.querySelector('input[type="password" i]')) };
        return JSON.stringify({ found: true, count, facts, tag: el.tagName.toLowerCase(),
          text: clip(isPassword ? '' : norm(textOf(el)), 80) });
        """

    private static let state = helpers + """
        const el = marked(nonce);
        const parts = [location.href, document.title, document.body ? document.body.innerText : ''];
        if (el) {
          parts.push(String(el.checked), String(typeof el.value === 'string' ? el.value.length : ''), String(el.open),
            ...['aria-expanded', 'aria-pressed', 'aria-selected', 'aria-checked', 'class']
              .map((name) => el.getAttribute(name) || ''), String(el.isConnected));
        } else { parts.push('gone'); }
        parts.push(document.activeElement ? document.activeElement.tagName : '');
        if (cleanup && el) el.removeAttribute('data-plasticine-target');
        return JSON.stringify({ url: location.href, title: document.title, state: parts.join('\\u0000') });
        """

    private static let click = helpers + """
        const el = marked(nonce);
        if (!el) return JSON.stringify(false);
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        if (typeof el.focus === 'function') el.focus({ preventScroll: true });
        const init = { bubbles: true, cancelable: true, composed: true, view: window, button: 0 };
        el.dispatchEvent(new PointerEvent('pointerdown', init));
        el.dispatchEvent(new MouseEvent('mousedown', init));
        el.dispatchEvent(new PointerEvent('pointerup', init));
        el.dispatchEvent(new MouseEvent('mouseup', init));
        el.click();
        return JSON.stringify(true);
        """

    private static let fill = helpers + """
        const el = marked(nonce);
        if (!el) return JSON.stringify({ ok: false, error: 'missing' });
        el.removeAttribute('data-plasticine-target');
        if (el.disabled || el.readOnly) return JSON.stringify({ ok: false, error: 'disabled' });
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        if (typeof el.focus === 'function') el.focus({ preventScroll: true });
        const set = (proto, next) => Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, next);
        const fire = () => {
          const typed = { bubbles: true, composed: true, inputType: 'insertText', data: value };
          el.dispatchEvent(new InputEvent('input', typed));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        let matches;
        if (tag === 'input' && (type === 'checkbox' || type === 'radio')) {
          const want = /^(true|on|1|yes|是|勾选|选中)$/i.test(value.trim());
          if (el.checked !== want) el.click();
          matches = el.checked === want;
        } else if (tag === 'input' || tag === 'textarea') {
          set(tag === 'input' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, value); fire();
          matches = el.value === value;
        } else if (tag === 'select') {
          const options = Array.from(el.options);
          const option = options.find((o) => o.value === value) || options.find((o) => o.text.trim() === value.trim());
          if (!option) return JSON.stringify({ ok: false, error: 'option' });
          set(HTMLSelectElement.prototype, option.value); fire();
          matches = el.value === option.value;
        } else if (el.isContentEditable) {
          el.textContent = value; fire();
          matches = el.innerText.trim() === value.trim();
        } else { return JSON.stringify({ ok: false, error: 'unfillable' }); }
        return JSON.stringify({ ok: true, matches, tag, type: type || (tag === 'input' ? 'text' : tag) });
        """

    private static let pageText = """
        return JSON.stringify({ url: location.href, title: document.title,
          text: document.body ? document.body.innerText : '' });
        """

    static func readPage(_ view: WKWebView, offset: Int) async throws -> JSONValue {
        try await run(view, read, [
            "offset": offset, "maxText": readTextChars, "maxLinks": readLinks, "maxFields": readFields,
            "linkText": linkTextChars, "linkHref": linkHrefChars, "fieldValue": fieldValueChars,
        ], as: JSONValue.self)
    }

    static func locateTarget(_ view: WKWebView, selector: String?, text: String?, nonce: String) async throws
        -> TabLocateResult {
        try await run(view, locate, ["selector": selector ?? NSNull(), "text": text ?? NSNull(), "nonce": nonce],
                      as: TabLocateResult.self)
    }

    static func readState(_ view: WKWebView, nonce: String, cleanup: Bool) async throws -> TabStateResult {
        try await run(view, state, ["nonce": nonce, "cleanup": cleanup], as: TabStateResult.self)
    }

    static func clickTarget(_ view: WKWebView, nonce: String) async throws -> Bool {
        try await run(view, click, ["nonce": nonce], as: Bool.self)
    }

    static func fillTarget(_ view: WKWebView, nonce: String, value: String) async throws -> TabFillResult {
        try await run(view, fill, ["nonce": nonce, "value": value], as: TabFillResult.self)
    }

    static func visibleText(_ view: WKWebView) async throws -> TabPageText {
        try await run(view, pageText, [:], as: TabPageText.self)
    }

    /// 跑一段脚本，回来的 JSON 字符串按 T 解码。用回调版：异步版在脚本回 undefined 时会出错。
    private static func run<T: Decodable>(
        _ view: WKWebView, _ body: String, _ arguments: [String: Any], as type: T.Type
    ) async throws -> T {
        let value: Any = try await withCheckedThrowingContinuation { continuation in
            view.callAsyncJavaScript(body, arguments: arguments, in: nil, in: .defaultClient) { result in
                continuation.resume(with: result)
            }
        }
        guard let text = value as? String, let data = text.data(using: .utf8) else {
            throw DeviceFailure.failed("网页没有回结果，可能还在载入；请稍后再试。")
        }
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw DeviceFailure.failed("网页回的结果格式不对，请重试。") }
    }
}
