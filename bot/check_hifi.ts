fetch('https://raw.githubusercontent.com/binimum/hifi-api/main/main.py')
  .then(r => r.text())
  .then(t => {
    const lines = t.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('playlist')) console.log(`Line ${i}: ${lines[i]}`);
    }
  });
