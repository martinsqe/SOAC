/* Builds a Postman v2.1 collection of every API route, for importing into
   Thunder Client (Collections → ≡ → Import → choose the generated file).

     node scripts/gen-thunder-collection.js

   Reads the app.use('/api/...') mounts in server.js and the router.<method>()
   lines in routes/*.js, so re-run it whenever routes change. */
const fs   = require('fs');
const path = require('path');

const ROOT    = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'thunder');
const OUT     = path.join(OUT_DIR, 'soac-api.postman_collection.json');

const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const mounts = [...server.matchAll(/app\.use\(\s*'([^']+)'[^;]*?require\('\.\/routes\/([^']+)'\)/g)]
  .map(([, prefix, file]) => ({ prefix, file: file.replace(/\.js$/, '') + '.js' }));

const ROUTE_RE = /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]\s*,([\s\S]*?)\)\s*;/g;
const ROLE_GUARDS = ['requireAdmin', 'requireCoordOrAdmin', 'requireCoordinator', 'requireFaculty', 'requireStaff', 'optionalAuth'];

const folders = mounts.map(({ prefix, file }) => {
  const src = fs.readFileSync(path.join(ROOT, 'routes', file), 'utf8');
  const fileWideAuth = /router\.use\([^)]*verifyToken/.test(src);
  const items = [...src.matchAll(ROUTE_RE)].map(([, method, sub, args]) => {
    const fullPath = (prefix + (sub === '/' ? '' : sub)).replace(/\/+/g, '/');
    const needsAuth = fileWideAuth || /verifyToken/.test(args);
    const guards = ROLE_GUARDS.filter(g => args.includes(g) || new RegExp(`router\\.use\\([^)]*${g}`).test(src));
    const isUpload = /upload|multer/i.test(args);
    const M = method.toUpperCase();
    const segments = fullPath.split('/').filter(Boolean);

    const request = {
      method: M,
      url: {
        raw: `{{baseUrl}}${fullPath}`,
        host: ['{{baseUrl}}'],
        path: segments,
        variable: segments.filter(p => p.startsWith(':')).map(p => ({ key: p.slice(1), value: '' })),
      },
      header: [{ key: 'x-campus', value: '{{campus}}', disabled: true, description: 'Admin only: Main / City campus' }],
      auth: needsAuth ? { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] } : { type: 'noauth' },
      description: [needsAuth ? 'Requires login (Bearer token).' : 'Public.', guards.length ? `Guards: ${guards.join(', ')}` : '']
        .filter(Boolean).join(' '),
    };
    if (['POST', 'PUT', 'PATCH'].includes(M)) {
      request.body = isUpload
        ? { mode: 'formdata', formdata: [] }
        : { mode: 'raw', raw: '{\n  \n}', options: { raw: { language: 'json' } } };
    }
    if (fullPath === '/api/auth/login') {
      request.body.raw = JSON.stringify({ email: '{{email}}', password: '{{password}}' }, null, 2);
    }
    return { name: `${M} ${fullPath}`, request };
  });
  return { name: prefix.replace('/api/', ''), item: items };
}).filter(f => f.item.length);

const collection = {
  info: {
    name: 'SOAC API',
    description: 'Generated from backend/routes by scripts/gen-thunder-collection.js. Run "auth → POST /api/auth/login" first, then copy accessToken into the {{token}} environment variable.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  variable: [
    { key: 'baseUrl',  value: 'http://localhost:5000' },
    { key: 'token',    value: '' },
    { key: 'email',    value: '' },
    { key: 'password', value: '' },
    { key: 'campus',   value: 'Main' },
  ],
  item: folders,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(collection, null, 2));
const total = folders.reduce((n, f) => n + f.item.length, 0);
console.log(`Wrote ${total} requests in ${folders.length} folders → ${path.relative(ROOT, OUT)}`);
