/* globals jsPDF, search */
'use strict';

var Node = function(node) {
  this.node = node;
  this.nodeType = node.nodeType;
  this.noChild = Boolean(node.firstChild) === false;

  this.TEXT_NODE = node.TEXT_NODE;
  this.ELEMENT_NODE = node.ELEMENT_NODE;
  this.firstChild = node.firstChild;
  this.nextSibling = node.nextSibling;

  this.parent = (() => {
    let n = node;
    while (n.nodeType !== n.ELEMENT_NODE) {
      n = n.parentNode;
    }
    return n;
  })();

  if (this.nodeType === node.TEXT_NODE) {
    this.range = document.createRange();
    this.range.selectNode(node);
    this.rect = this.range.getBoundingClientRect();
    this.rects = this.range.getClientRects();
  }
  if (this.nodeType === node.ELEMENT_NODE) {
    this.rect = node.getBoundingClientRect();
    this.rects = node.getClientRects();
  }

  function color(c) {
    const color = /(\d+), (\d+), (\d+)/.exec(c);
    return [color[1], color[2], color[3]].map(Number);
  }
  function font(fonts) {
    fonts = fonts.replace(';', '').split(/\s*,\s*/);

    const node = document.createElement('span');
    node.textContent = 'QQwWeErRtTyYuUiIoOpP1!2@3#4$5%6^7&8*9(0)<>.-_';
    node.style.fontFamily = fonts;
    document.body.appendChild(node);
    const ref = node.getBoundingClientRect();
    const rtn = fonts.filter(font => {
      node.style.fontFamily = font;
      const rect = node.getBoundingClientRect();
      return rect.width === ref.width && rect.height === ref.height;
    });
    document.body.removeChild(node);
    return rtn.shift() || 'System Default';
  }
  Object.defineProperty(this, 'styles', {
    get() {
      const styles = window.getComputedStyle(this.parent, null);
      return Object.assign({}, styles, {
        'font-size': parseInt(styles['font-size']),
        'border-top-width': parseInt(styles['border-top-width']),
        'border-bottom-width': parseInt(styles['border-bottom-width']),
        'border-left-width': parseInt(styles['border-left-width']),
        'border-right-width': parseInt(styles['border-right-width']),

        'font-family': font(styles['font-family']),
        'font-weight': styles['font-weight'],

        'color': color(styles.color),

        'border-top-color': color(styles['border-top-color']),
        'border-bottom-color': color(styles['border-bottom-color']),
        'border-left-color': color(styles['border-left-color']),
        'border-right-color': color(styles['border-right-color'])
      });
    }
  });

  function isBoundary(node) {
    return Boolean(node) &&
      (node.nodeType === node.ELEMENT_NODE || node.nodeType === node.TEXT_NODE) &&
      node.tagName !== 'BR';
  }
  const value = (node.nodeValue || node.value || node.textContent)
    .replace(/^\s+/, isBoundary(node.previousSibling) ? ' ' : '')
    .replace(/\s+$/, isBoundary(node.nextSibling) ? ' ' : '');
  this.value = value;
};
Node.prototype.isMultiLine = function() {
  if (this.node.nodeType === this.TEXT_NODE) {
    const range = document.createRange();
    range.selectNode(this.node);
    return range.getClientRects().length > 1;
  }
  else {
    return false;
  }
};

var PDF = function({
  orientation = 'landscape',
  root = document.body,
  width = root.clientWidth,
  height = root.clientHeight,
  padding = 50
} = {}) {
  this.doc = new jsPDF({
    orientation: orientation,
    unit: 'pt',
    format: [width, height].map(String)
  });
  this.root = root;
  this.height = height - padding;
  this.width = width;
  // generate pages
  const pages = Math.ceil(root.clientHeight / height);
  for (let i = 1; i < pages; i += 1) {
    this.doc.addPage();
  }
  //
  //console.log(this.doc.getFontList())
};

PDF.prototype.collect = function() {
  const root = this.root;
  return {
    images: () => {
      function fetch(img) {
        return new Promise(resolve => {
          chrome.runtime.sendMessage({
            method: 'image-to-data',
            src: img.src
          }, data => resolve({
            img,
            data
          }));
        });
      }
      return Promise.all([...root.querySelectorAll('img')].map(fetch)).then(os => os.filter(o => o.data));
    },
    lines: () => {
      const nodes = [...document.body.getElementsByTagName('*')]
        .filter(node => node.nodeType === node.ELEMENT_NODE)
        .map(node => new Node(node));
      return Promise.resolve(nodes);
    },
    nodes: () => {
      const collect = node => {
        let all = [];
        for (node = node.firstChild; node; node = node.nextSibling) {
          node = new Node(node);
          if (node.nodeType === node.TEXT_NODE) {
            if (node.value.trim()) {
              all.push(node);
            }
          }
          else if (node.nodeType === node.ELEMENT_NODE && node.noChild) {
            if (node.value.trim()) {
              all.push(node);
            }
          }
          else if (node.nodeType === node.ELEMENT_NODE) {
            all = [...all, ...collect(node)];
          }
        }
        return all;
      };
      const nodes = collect(root).filter(node => node.value.trim() && node.rect.width && node.rect.height);
      return Promise.resolve(nodes);
    }
  };
};

PDF.prototype.split = function(node) {
  if (node.isMultiLine()) {
    const r = document.createRange();
    r.setStart(node.node, 0);
    const indices = [
      0,
      ...node.value.split('').map((c, i) => {
        r.setEnd(node.node, i);
        return r.getClientRects().length;
      }).map((v, i, l) => v - (l[i - 1] || v)).map((v, i) => (v ? i - 1 : false)).filter(i => i)
    ];
    return [...node.rects].map((rect, i) => ({
      rect,
      value: node.value.substring(indices[i], indices[i + 1])
    }));
  }
  else {
    return [{
      value: node.value,
      rect: node.rect
    }];
  }
};

PDF.prototype.addImage = function(node) {
  const rect = node.img.getBoundingClientRect();
  const {left, top, width, height} = this.adjustPage(rect);
  this.doc.addImage(node.data, 'PNG', left, top, width, height);
};

PDF.prototype.font = function(styles) {
  // font size
  // this.doc.addFont(styles['font-size'], styles['font-size']);
  this.doc.setFontSize(styles['font-size']);
  // font family
  this.doc.setFont(styles['font-family']);
  // font style
  if (styles['font-style'] === 'italic' && styles['font-weight'] === 'bold') {
    this.doc.setFontType('bolditalic');
  }
  else if (styles['font-style'] === 'italic') {
    this.doc.setFontType('italic');
  }
  else if (styles['font-weight'] === 'bold') {
    this.doc.setFontType('bold');
  }
  else {
    this.doc.setFontType('normal');
  }
  // color
  this.doc.setTextColor(...styles.color);
};

PDF.prototype.addNode = function(node) {
  this.font(node.styles);
  return this.split(node).forEach(({rect, value}) => {
    const div = document.createElement('div');
    div.style = `
      position: absolute;
      top: ${rect.top}px;
      left: ${rect.left}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      border: solid 1px blue;
    `;
    document.body.appendChild(div);

    const {left, top, height} = this.adjustPage(rect);
    // make sure text is fitting inside the rect
    /*let loop = true;
    while (loop) {
      let fontSize = this.doc.internal.getFontSize();
      const w = this.doc.getStringUnitWidth(value) * fontSize;
      if (w > width) {
        console.log(width, w, value, fontSize);
        fontSize -= 0.1;
        this.doc.setFontSize(fontSize);
      }
      else {
        loop = false;
      }
    }*/
    const lineHeight = this.doc.getLineHeight();
    this.doc.text(value, left, top + lineHeight / 3 + height / 2);
  });
};

PDF.prototype.addLines = function(node) {
  if (node.nodeType !== node.ELEMENT_NODE) {
    return;
  }
  const {top, left, width, height} = this.adjustPage(node.rect);
  //const {top, left, width, height} = node.rect;

  let thickness = node.styles['border-top-width'];
  if (thickness) {
    // console.log(thickness, 'top');
    this.doc.setDrawColor(...node.styles['border-top-color']);
    this.doc.setLineWidth(thickness);
    this.doc.line(left, top + thickness / 2, left + width, top + thickness / 2);
  }
  thickness = node.styles['border-bottom-width'];
  if (thickness) {
    // console.log(thickness, 'bottom');
    this.doc.setDrawColor(...node.styles['border-bottom-color']);
    this.doc.setLineWidth(thickness);
    this.doc.line(left, top + height - thickness / 2, left + width, top + height - thickness / 2);
  }
  thickness = node.styles['border-left-width'];
  if (thickness) {
    // console.log(thickness, 'left');
    this.doc.setDrawColor(...node.styles['border-left-color']);
    this.doc.setLineWidth(thickness);
    this.doc.line(left + thickness / 2, top, left + thickness / 2, top + height);
  }
  thickness = node.styles['border-right-width'];
  if (thickness) {
    // console.log(thickness, 'right');
    this.doc.setDrawColor(...node.styles['border-right-color']);
    this.doc.setLineWidth(thickness);
    this.doc.line(left + width - thickness / 2, top, left + width - thickness / 2, top + height);
  }
};

PDF.prototype.adjustPage = function(rect) {
  const {width, height} = rect;
  let {top, left} = rect;
  left += window.scrollX;
  top += window.scrollY;

  const n = Math.floor(top / this.height);

  this.doc.setPage(n + 1);
  return {
    top: top % this.height,
    left,
    width,
    height
  };
};

chrome.storage.local.get({
  width: 595.28 / 0.75,
  height: 841.89 / 0.75,
  padding: 10,
  orientation: 'landscape'
}, prefs => {
  document.body.style.width = prefs.width + 'px';
  document.body.style['box-sizing'] = 'border-box';
  document.body.style.margin = '0';
  document.body.style['background-color'] = '#fff';
  document.body.style.padding = prefs.padding + 'px';

  const pdf = new PDF({
    width: prefs.width,
    height: prefs.height
  });

  const {nodes, lines, images} = pdf.collect();
  lines().then(nodes => nodes.forEach(node => pdf.addLines(node)))
  .then(() => {
    return nodes().then(nodes => nodes.forEach(node => pdf.addNode(node)));
  })
  .then(() => {
    return images().then(nodes => nodes.forEach(img => pdf.addImage(img))).then(() => console.log('images are done'));
  })
  .then(() => {
    console.log('saving');
    chrome.runtime.sendMessage({
      method: 'download',
      url: pdf.doc.output('datauristring'),
      cmd: search.cm
    });
  });
});