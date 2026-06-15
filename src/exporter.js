const Exporter = (() => {

  async function downloadZip(files, zipName = 'vertical_life_export.zip') {
    const zip = new JSZip();
    for (const f of files) {
      zip.file(f.filename, f.content);
    }
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    triggerDownload(blob, zipName);
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  return { downloadZip };
})();
