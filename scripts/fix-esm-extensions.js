const fs = require('fs');
const path = require('path');

function getAllJsFiles(dir, files = []) {
  const items = fs.readdirSync(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      getAllJsFiles(fullPath, files);
    } else if (item.endsWith('.js')) {
      files.push(fullPath);
    }
  }

  return files;
}

function fixEsmExtensions() {
  const esmDir = 'lib/esm';
  if (!fs.existsSync(esmDir)) {
    console.log('ESM directory not found');
    return;
  }

  const jsFiles = getAllJsFiles(esmDir);

  jsFiles.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    let changed = false;

    // Fix relative imports: from './something' to './something.js' or './something/index.js'
    content = content.replace(/from '(\.[^']+)';/g, (match, importPath) => {
      const fileDir = path.dirname(file);
      const resolvedPath = path.resolve(fileDir, importPath);

      // Check if it's a directory with index.js
      if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
        const indexPath = path.join(resolvedPath, 'index.js');
        if (fs.existsSync(indexPath)) {
          changed = true;
          return `from '${importPath}/index.js';`;
        }
      }

      // Check if adding .js makes it a valid file
      const jsPath = resolvedPath + '.js';
      if (fs.existsSync(jsPath)) {
        changed = true;
        return `from '${importPath}.js';`;
      }

      // Return unchanged if no valid resolution found
      return match;
    });

    if (changed) {
      fs.writeFileSync(file, content);
      console.log(`Fixed ESM extensions in: ${file}`);
    }
  });
}

fixEsmExtensions();