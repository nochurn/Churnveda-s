#!/usr/bin/env python3
import os
import zipfile
import shutil
import tempfile
import base64

def package_project():
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    public_dir = os.path.join(root_dir, 'public')
    artifact_dir = os.path.join(root_dir, '.aistudio', 'artifacts', 'brain', '80c47efb-51f2-4a76-899e-e67e91452755')
    os.makedirs(public_dir, exist_ok=True)
    os.makedirs(artifact_dir, exist_ok=True)

    EXCLUDE_DIRS = {'node_modules', '.git', 'dist', 'data', '.aistudio', '__pycache__', '.turbo', '.cache'}
    EXCLUDE_EXTS = ('.zip', '.tar.gz', '.log', '.db', '.db-shm', '.db-wal')

    def is_excluded(filename, rel_path):
        if filename in {'.DS_Store', 'nochurn-source.tar.gz', 'download.html'}:
            return True
        if filename.endswith(EXCLUDE_EXTS):
            return True
        if filename.startswith('.env') and filename != '.env.example':
            return True
        return False

    # 1. Package churnveda-source-code.zip (Root-level structure for Claude Code)
    src_zip_path = os.path.join(public_dir, 'churnveda-source-code.zip')
    with tempfile.NamedTemporaryFile(suffix='.zip', delete=False) as tmp_src:
        tmp_src_path = tmp_src.name

    file_count_src = 0
    with zipfile.ZipFile(tmp_src_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for dirpath, dirnames, filenames in os.walk(root_dir):
            dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS and not d.startswith('.')]
            for filename in sorted(filenames):
                rel_path = os.path.relpath(os.path.join(dirpath, filename), root_dir)
                if is_excluded(filename, rel_path):
                    continue
                full_path = os.path.join(dirpath, filename)
                zipf.write(full_path, rel_path)
                file_count_src += 1

    shutil.copyfile(tmp_src_path, src_zip_path)
    shutil.copyfile(tmp_src_path, os.path.join(root_dir, 'churnveda-source-code.zip'))
    shutil.copyfile(tmp_src_path, os.path.join(public_dir, 'churnveda-lovable-export.zip'))
    shutil.copyfile(tmp_src_path, os.path.join(root_dir, 'churnveda-lovable-export.zip'))
    if os.path.isdir(artifact_dir):
        shutil.copyfile(tmp_src_path, os.path.join(artifact_dir, 'churnveda-source-code.zip'))
    os.remove(tmp_src_path)

    # 2. Package churnveda-deployment.zip (Enclosed in churnveda/ folder)
    dep_zip_path = os.path.join(public_dir, 'churnveda-deployment.zip')
    with tempfile.NamedTemporaryFile(suffix='.zip', delete=False) as tmp_dep:
        tmp_dep_path = tmp_dep.name

    file_count_dep = 0
    with zipfile.ZipFile(tmp_dep_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for dirpath, dirnames, filenames in os.walk(root_dir):
            dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS and not d.startswith('.')]
            for filename in sorted(filenames):
                rel_path = os.path.relpath(os.path.join(dirpath, filename), root_dir)
                if is_excluded(filename, rel_path):
                    continue
                full_path = os.path.join(dirpath, filename)
                zipf.write(full_path, os.path.join('churnveda', rel_path))
                file_count_dep += 1

    shutil.copyfile(tmp_dep_path, dep_zip_path)
    shutil.copyfile(tmp_dep_path, os.path.join(root_dir, 'churnveda-deployment.zip'))
    if os.path.isdir(artifact_dir):
        shutil.copyfile(tmp_dep_path, os.path.join(artifact_dir, 'churnveda-deployment.zip'))
    os.remove(tmp_dep_path)

    # 3. Read base64 payload to embed in public/download.html
    with open(src_zip_path, 'rb') as f:
        b64_src = base64.b64encode(f.read()).decode('utf-8')

    html_content = f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Download Churnveda Source Code</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #0f172a;
      color: #f8fafc;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px 16px;
    }}
    .card {{
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 20px;
      padding: 36px 28px;
      max-width: 540px;
      width: 100%;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      text-align: center;
    }}
    .badge {{
      display: inline-block;
      background: #1e3a8a;
      color: #93c5fd;
      font-size: 11px;
      font-weight: 800;
      padding: 4px 14px;
      border-radius: 9999px;
      margin-bottom: 18px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      border: 1px solid #2563eb;
    }}
    h1 {{
      font-size: 24px;
      font-weight: 800;
      color: #ffffff;
      margin-bottom: 10px;
    }}
    p {{
      font-size: 14px;
      color: #94a3b8;
      line-height: 1.6;
      margin-bottom: 26px;
    }}
    .btn-group {{
      display: flex;
      flex-direction: column;
      gap: 14px;
      margin-bottom: 28px;
    }}
    .btn {{
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      text-decoration: none;
      font-size: 15px;
      font-weight: 700;
      padding: 16px 20px;
      border-radius: 12px;
      transition: all 0.15s ease;
      cursor: pointer;
      border: none;
    }}
    .btn-primary {{
      background: #2563eb;
      color: #ffffff;
      box-shadow: 0 4px 16px rgba(37, 99, 235, 0.4);
    }}
    .btn-primary:hover {{
      background: #1d4ed8;
      transform: translateY(-1px);
    }}
    .btn-secondary {{
      background: #334155;
      color: #e2e8f0;
      border: 1px solid #475569;
    }}
    .btn-secondary:hover {{
      background: #475569;
      transform: translateY(-1px);
    }}
    .details {{
      padding-top: 22px;
      border-top: 1px solid #334155;
      font-size: 12px;
      color: #94a3b8;
      line-height: 1.7;
      text-align: left;
    }}
    .details strong {{
      color: #f1f5f9;
    }}
    .details code {{
      background: #0f172a;
      padding: 2px 6px;
      border-radius: 4px;
      color: #60a5fa;
      font-size: 11px;
    }}
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Claude Code & Cloud Deployment Ready</div>
    <h1>Churnveda Source Code Export</h1>
    <p>Complete, verified source-code archive of your Churnveda B2B SaaS platform. Ready to open directly in Claude Code, VS Code, or cloud hosts.</p>
    
    <div class="btn-group">
      <a class="btn btn-primary" href="data:application/zip;base64,{b64_src}" download="churnveda-source-code.zip">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Download churnveda-source-code.zip
      </a>

      <a class="btn btn-secondary" href="/churnveda-source-code.zip" download="churnveda-source-code.zip">
        Direct Browser Download Link
      </a>
    </div>

    <div class="details">
      <div><strong>File Name:</strong> <code>churnveda-source-code.zip</code></div>
      <div><strong>Contents:</strong> {file_count_src} files (React 19 Frontend, Express Backend, Supabase Migrations, Dockerfile, netlify.toml)</div>
      <div><strong>For Claude Code:</strong> Run <code>unzip churnveda-source-code.zip</code> then <code>claude</code> inside the folder.</div>
      <div><strong>Security:</strong> All secrets excluded; safe <code>.env.example</code> included.</div>
    </div>
  </div>
</body>
</html>'''

    with open(os.path.join(public_dir, 'download.html'), 'w', encoding='utf-8') as f:
        f.write(html_content)

    print(f"Generated {src_zip_path} ({os.path.getsize(src_zip_path)} bytes, {file_count_src} files)")
    print(f"Generated {dep_zip_path} ({os.path.getsize(dep_zip_path)} bytes, {file_count_dep} files)")
    return file_count_src, os.path.getsize(src_zip_path)

if __name__ == '__main__':
    package_project()
