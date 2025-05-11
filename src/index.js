// src/index.js
import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: true
});

document.addEventListener('DOMContentLoaded', () => {
  const mermaidElement = document.getElementById('mermaid');
  mermaid.render('mermaidChart', mermaidElement.textContent, (svgCode) => {
    mermaidElement.innerHTML = svgCode;
  });
});