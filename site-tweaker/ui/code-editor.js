/* 给代码 <textarea> 加上行号、Tab 缩进、回车自动缩进 */
(function (root) {
  'use strict';

  const INDENT = '  ';

  /** 插入文本并保留撤销记录（execCommand 失效时退回 setRangeText） */
  function insert(textarea, text) {
    if (!document.execCommand('insertText', false, text)) {
      textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, 'end');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function lineStartOf(value, pos) {
    return value.lastIndexOf('\n', pos - 1) + 1;
  }

  function indentLines(textarea, outdent) {
    const { value, selectionStart: start, selectionEnd: end } = textarea;
    const from = lineStartOf(value, start);
    // 选区恰好停在下一行行首时，不把那一行算进来
    const last = end > start && value[end - 1] === '\n' ? end - 1 : end;
    let to = value.indexOf('\n', last);
    if (to === -1) to = value.length;

    const lines = value.slice(from, to).split('\n');
    const changed = lines.map((line) => {
      if (!outdent) return INDENT + line;
      if (line.startsWith(INDENT)) return line.slice(INDENT.length);
      return line.replace(/^[ \t]/, '');
    });
    const text = changed.join('\n');
    if (text === lines.join('\n')) return;

    textarea.setSelectionRange(from, to);
    insert(textarea, text);
    if (start === end) {
      const caret = Math.max(from, start + changed[0].length - lines[0].length);
      textarea.setSelectionRange(caret, caret);
    } else {
      textarea.setSelectionRange(from, from + text.length);
    }
  }

  function attach(textarea, gutter) {
    let lineCount = 0;

    function render() {
      const count = textarea.value.split('\n').length;
      if (count !== lineCount) {
        lineCount = count;
        let text = '';
        for (let i = 1; i <= count; i++) text += i + '\n';
        // 多留几行，横向滚动条出现时行号仍能和代码对齐
        gutter.textContent = text + '\n\n';
      }
      gutter.scrollTop = textarea.scrollTop;
    }

    textarea.addEventListener('input', render);
    textarea.addEventListener('scroll', () => {
      gutter.scrollTop = textarea.scrollTop;
    });

    textarea.addEventListener('keydown', (e) => {
      if (e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;
      const { value, selectionStart: start, selectionEnd: end } = textarea;

      if (e.key === 'Tab') {
        e.preventDefault();
        if (start === end && !e.shiftKey) insert(textarea, INDENT);
        else indentLines(textarea, e.shiftKey);
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const before = value.slice(lineStartOf(value, start), start);
        const indent = /^[ \t]*/.exec(before)[0];
        const opens = /[{[(]\s*$/.test(before);
        if (opens && /^[}\])]/.test(value.slice(end))) {
          // 光标在一对括号中间：展开成三行
          insert(textarea, '\n' + indent + INDENT + '\n' + indent);
          const caret = start + 1 + indent.length + INDENT.length;
          textarea.setSelectionRange(caret, caret);
        } else {
          insert(textarea, '\n' + indent + (opens ? INDENT : ''));
        }
        return;
      }

      if ((e.key === '}' || e.key === ']' || e.key === ')') && start === end) {
        // 在空白行输入右括号时自动减少一级缩进
        const before = value.slice(lineStartOf(value, start), start);
        if (/^ +$/.test(before) && before.endsWith(INDENT)) {
          e.preventDefault();
          textarea.setSelectionRange(start - INDENT.length, start);
          insert(textarea, e.key);
        }
      }
    });

    render();
    return { refresh: render };
  }

  root.CodeEditor = { attach };
})(self);
