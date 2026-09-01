require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const defaultState = {
  employees: [
    { id: 'emp-1', name: 'سارة', status: 'متاح' },
    { id: 'emp-2', name: 'أحمد', status: 'مشغول' },
    { id: 'emp-3', name: 'ليلى', status: 'متاح' }
  ],
  branches: [
    { id: 'branch-1', name: 'فرع الرياض', status: 'مفتوح' },
    { id: 'branch-2', name: 'فرع جدة', status: 'مفتوح' },
    { id: 'branch-3', name: 'فرع الدمام', status: 'مشغول' }
  ],
  products: [
    { id: 'p-1', name: 'قهوة عربية', price: 18, stock: 42, category: 'مشروبات' },
    { id: 'p-2', name: 'شاي بالنعناع', price: 12, stock: 28, category: 'مشروبات' },
    { id: 'p-3', name: 'كيك الشوكولاتة', price: 25, stock: 15, category: 'حلويات' },
    { id: 'p-4', name: 'ساندويتش دجاج', price: 30, stock: 9, category: 'وجبات' },
    { id: 'p-5', name: 'ماء معدني', price: 5, stock: 4, category: 'مشروبات' }
  ],
  orders: [],
  summary: {
    revenueToday: 4250,
    onlineOrders: 14,
    directSales: 23,
    lowStock: 2,
    openBranches: 2
  }
};

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultState, null, 2), 'utf8');
  }
}

function loadState() {
  ensureDataFiles();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...defaultState, ...parsed, summary: { ...defaultState.summary, ...(parsed.summary || {}) } };
  } catch (error) {
    return { ...defaultState };
  }
}

let state = loadState();

function saveState() {
  ensureDataFiles();
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
}

async function syncToSupabase() {
  if (!supabase) return;

  try {
    await supabase.from('products').upsert(state.products.map((item) => ({ ...item, price: Number(item.price), stock: Number(item.stock) })));
    await supabase.from('branches').upsert(state.branches);
    await supabase.from('employees').upsert(state.employees);
    await supabase.from('orders').upsert(state.orders.map((order) => ({ ...order, total: Number(order.total) })));
  } catch (error) {
    console.warn('Supabase sync skipped:', error.message);
  }
}

async function hydrateFromSupabase() {
  if (!supabase) return;

  try {
    const [productsRes, branchesRes, employeesRes, ordersRes] = await Promise.all([
      supabase.from('products').select('*').order('id'),
      supabase.from('branches').select('*').order('id'),
      supabase.from('employees').select('*').order('id'),
      supabase.from('orders').select('*').order('createdAt', { ascending: false })
    ]);

    if (!productsRes.error && productsRes.data?.length) state.products = productsRes.data;
    if (!branchesRes.error && branchesRes.data?.length) state.branches = branchesRes.data;
    if (!employeesRes.error && employeesRes.data?.length) state.employees = employeesRes.data;
    if (!ordersRes.error && ordersRes.data?.length) state.orders = ordersRes.data;
    saveState();
  } catch (error) {
    console.warn('Supabase hydration skipped:', error.message);
  }
}

function getLowStockCount() {
  return state.products.filter((item) => item.stock < 5).length;
}

function getSummary() {
  const totalRevenue = state.orders.reduce((sum, order) => sum + Number(order.total || 0), 0) + state.summary.revenueToday;
  return {
    revenueToday: totalRevenue,
    onlineOrders: state.orders.filter((o) => o.type === 'online').length + state.summary.onlineOrders,
    directSales: state.orders.filter((o) => o.type === 'pos').length + state.summary.directSales,
    lowStock: getLowStockCount(),
    openBranches: state.branches.filter((b) => b.status === 'مفتوح').length,
    totalOrders: state.orders.length
  };
}

function getDashboardData() {
  return {
    summary: getSummary(),
    products: state.products,
    branches: state.branches,
    employees: state.employees,
    orders: state.orders.slice().reverse().slice(0, 8)
  };
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function getCookies(req) {
  const cookieHeader = req.headers.cookie || '';
  return cookieHeader.split(';').reduce((acc, pair) => {
    const [key, value] = pair.split('=');
    if (key && value) acc[key.trim()] = decodeURIComponent(value.trim());
    return acc;
  }, {});
}

function isAuthenticated(req) {
  const cookies = getCookies(req);
  return cookies.session_token === 'admin-session';
}

function requireAuth(req, res) {
  if (!isAuthenticated(req)) {
    sendJson(res, 401, { success: false, message: 'يجب تسجيل الدخول أولاً' });
    return false;
  }
  return true;
}

function serveFile(res, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    res.writeHead(200, { 'Content-Type': mimeTypes[extension] || 'application/octet-stream' });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    try {
      const payload = await readRequestBody(req);
      const username = String(payload.username || '').trim();
      const password = String(payload.password || '').trim();

      if (username === ADMIN_USER && password === ADMIN_PASSWORD) {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': 'session_token=admin-session; Path=/; SameSite=Lax'
        });
        res.end(JSON.stringify({ success: true, message: 'تم تسجيل الدخول بنجاح' }));
        return;
      }

      sendJson(res, 401, { success: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
      return;
    } catch (error) {
      sendJson(res, 400, { success: false, message: error.message || 'فشل تسجيل الدخول' });
      return;
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': 'session_token=; Path=/; Max-Age=0; SameSite=Lax'
    });
    res.end(JSON.stringify({ success: true, message: 'تم تسجيل الخروج' }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/products') {
    sendJson(res, 200, { products: state.products });
    return;
  }

  if (req.method === 'PATCH' && url.pathname.startsWith('/api/products/')) {
    if (!requireAuth(req, res)) return;
    try {
      const productId = url.pathname.split('/').filter(Boolean).pop();
      const product = state.products.find((item) => item.id === productId);
      if (!product) {
        sendJson(res, 404, { success: false, message: 'المنتج غير موجود' });
        return;
      }

      const payload = await readRequestBody(req);
      const stockValue = payload.stock !== undefined ? Number(payload.stock) : undefined;
      const deltaValue = payload.delta !== undefined ? Number(payload.delta) : undefined;

      if (stockValue !== undefined) {
        if (Number.isNaN(stockValue) || stockValue < 0) {
          sendJson(res, 400, { success: false, message: 'الكمية غير صحيحة' });
          return;
        }
        product.stock = stockValue;
      } else if (deltaValue !== undefined) {
        if (Number.isNaN(deltaValue)) {
          sendJson(res, 400, { success: false, message: 'القيمة غير صحيحة' });
          return;
        }
        product.stock = Math.max(0, Number(product.stock || 0) + deltaValue);
      }

      saveState();
      syncToSupabase();
      sendJson(res, 200, { success: true, message: 'تم تحديث الكمية بنجاح', product, summary: getSummary() });
      return;
    } catch (error) {
      sendJson(res, 400, { success: false, message: error.message || 'فشل تحديث المنتج' });
      return;
    }
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/products/')) {
    if (!requireAuth(req, res)) return;
    try {
      const productId = url.pathname.split('/').filter(Boolean).pop();
      const index = state.products.findIndex((item) => item.id === productId);
      if (index === -1) {
        sendJson(res, 404, { success: false, message: 'المنتج غير موجود' });
        return;
      }

      state.products.splice(index, 1);
      saveState();
      syncToSupabase();
      sendJson(res, 200, { success: true, message: 'تم حذف المنتج بنجاح', summary: getSummary() });
      return;
    } catch (error) {
      sendJson(res, 400, { success: false, message: error.message || 'فشل حذف المنتج' });
      return;
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/branches') {
    sendJson(res, 200, { branches: state.branches });
    return;
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/branches/')) {
    if (!requireAuth(req, res)) return;
    try {
      const branchId = url.pathname.split('/').filter(Boolean).pop();
      const index = state.branches.findIndex((item) => item.id === branchId);
      if (index === -1) {
        sendJson(res, 404, { success: false, message: 'الفرع غير موجود' });
        return;
      }

      state.branches.splice(index, 1);
      saveState();
      syncToSupabase();
      sendJson(res, 200, { success: true, message: 'تم حذف الفرع بنجاح', summary: getSummary() });
      return;
    } catch (error) {
      sendJson(res, 400, { success: false, message: error.message || 'فشل حذف الفرع' });
      return;
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/employees') {
    sendJson(res, 200, { employees: state.employees });
    return;
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/employees/')) {
    if (!requireAuth(req, res)) return;
    try {
      const employeeId = url.pathname.split('/').filter(Boolean).pop();
      const index = state.employees.findIndex((item) => item.id === employeeId);
      if (index === -1) {
        sendJson(res, 404, { success: false, message: 'الموظف غير موجود' });
        return;
      }

      state.employees.splice(index, 1);
      saveState();
      syncToSupabase();
      sendJson(res, 200, { success: true, message: 'تم حذف الموظف بنجاح', summary: getSummary() });
      return;
    } catch (error) {
      sendJson(res, 400, { success: false, message: error.message || 'فشل حذف الموظف' });
      return;
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/summary') {
    sendJson(res, 200, { summary: getSummary() });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/dashboard') {
    sendJson(res, 200, getDashboardData());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/orders') {
    sendJson(res, 200, { orders: state.orders.slice().reverse() });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/products') {
    if (!requireAuth(req, res)) return;
    try {
      const payload = await readRequestBody(req);
      const name = String(payload.name || '').trim();
      const price = Number(payload.price || 0);
      const stock = Number(payload.stock || 0);
      const category = String(payload.category || 'عام').trim();

      if (!name || price <= 0 || stock < 0) {
        sendJson(res, 400, { success: false, message: 'أدخل بيانات المنتج كاملة وصحيحة' });
        return;
      }

      const product = {
        id: `p-${Date.now()}`,
        name,
        price,
        stock,
        category
      };
      state.products.push(product);
      saveState();
      syncToSupabase();
      sendJson(res, 200, { success: true, message: 'تم إضافة المنتج بنجاح', product, summary: getSummary() });
      return;
    } catch (error) {
      sendJson(res, 400, { success: false, message: error.message || 'فشل في إضافة المنتج' });
      return;
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/branches') {
    if (!requireAuth(req, res)) return;
    try {
      const payload = await readRequestBody(req);
      const name = String(payload.name || '').trim();
      const status = String(payload.status || 'مفتوح').trim();

      if (!name) {
        sendJson(res, 400, { success: false, message: 'اسم الفرع مطلوب' });
        return;
      }

      const branch = {
        id: `branch-${Date.now()}`,
        name,
        status
      };
      state.branches.push(branch);
      saveState();
      syncToSupabase();
      sendJson(res, 200, { success: true, message: 'تم إضافة الفرع بنجاح', branch, summary: getSummary() });
      return;
    } catch (error) {
      sendJson(res, 400, { success: false, message: error.message || 'فشل في إضافة الفرع' });
      return;
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/employees') {
    if (!requireAuth(req, res)) return;
    try {
      const payload = await readRequestBody(req);
      const name = String(payload.name || '').trim();
      const status = String(payload.status || 'متاح').trim();

      if (!name) {
        sendJson(res, 400, { success: false, message: 'اسم الموظف مطلوب' });
        return;
      }

      const employee = {
        id: `emp-${Date.now()}`,
        name,
        status
      };
      state.employees.push(employee);
      saveState();
      syncToSupabase();
      sendJson(res, 200, { success: true, message: 'تم إضافة الموظف بنجاح', employee, summary: getSummary() });
      return;
    } catch (error) {
      sendJson(res, 400, { success: false, message: error.message || 'فشل في إضافة الموظف' });
      return;
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/orders/online') {
    if (!requireAuth(req, res)) return;
    try {
      const payload = await readRequestBody(req);
      const product = state.products.find((item) => item.id === payload.productId);
      const availableEmployee = state.employees.find((employee) => employee.status === 'متاح');

      if (!product) {
        sendJson(res, 400, { success: false, message: 'المنتج غير موجود' });
        return;
      }

      if (!availableEmployee) {
        sendJson(res, 400, { success: false, message: 'لا يوجد موظف متاح حالياً' });
        return;
      }

      const quantity = Number(payload.quantity || 1);
      if (product.stock < quantity) {
        sendJson(res, 400, { success: false, message: 'المخزون غير كافٍ لهذا الطلب' });
        return;
      }

      product.stock -= quantity;
      const total = product.price * quantity;
      const order = {
        id: `OL-${Date.now()}`,
        type: 'online',
        customer: payload.customer || 'عميل جديد',
        employee: availableEmployee.name,
        product: product.name,
        quantity,
        total,
        createdAt: new Date().toISOString()
      };
      state.orders.push(order);
      saveState();
      syncToSupabase();

      sendJson(res, 200, {
        success: true,
        message: 'تم تأكيد الطلب الإلكتروني بنجاح',
        whatsappLink: `https://wa.me/966500000000?text=${encodeURIComponent(`طلب جديد: ${product.name} - الكمية: ${quantity} - الإجمالي: ${total} ريال`)}`,
        summary: getSummary(),
        order
      });
      return;
    } catch (error) {
      sendJson(res, 400, { success: false, message: error.message || 'فشل في معالجة الطلب' });
      return;
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/orders/pos') {
    if (!requireAuth(req, res)) return;
    try {
      const payload = await readRequestBody(req);
      const product = state.products.find((item) => item.id === payload.productId);
      const branch = state.branches.find((item) => item.id === payload.branchId);

      if (!product) {
        sendJson(res, 400, { success: false, message: 'المنتج غير موجود في القائمة' });
        return;
      }

      if (!branch) {
        sendJson(res, 400, { success: false, message: 'الرجاء اختيار فرع صحيح' });
        return;
      }

      const quantity = Number(payload.quantity || 1);
      if (product.stock < quantity) {
        sendJson(res, 400, { success: false, message: 'لا يوجد مخزون كافٍ في هذا الفرع' });
        return;
      }

      product.stock -= quantity;
      const total = product.price * quantity;
      const order = {
        id: `POS-${Date.now()}`,
        type: 'pos',
        branch: branch.name,
        product: product.name,
        quantity,
        total,
        createdAt: new Date().toISOString()
      };
      state.orders.push(order);
      saveState();
      syncToSupabase();

      sendJson(res, 200, {
        success: true,
        message: 'تمت عملية البيع بنجاح',
        receipt: {
          branch: branch.name,
          orderId: order.id,
          product: product.name,
          quantity,
          total,
          date: new Date().toLocaleString('ar-EG')
        },
        summary: getSummary(),
        order
      });
      return;
    } catch (error) {
      sendJson(res, 400, { success: false, message: error.message || 'تعذر إتمام البيع' });
      return;
    }
  }

  if (req.method === 'GET' && url.pathname === '/') {
    serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
    return;
  }

  const requestedFilePath = path.join(PUBLIC_DIR, url.pathname);
  if (requestedFilePath.startsWith(PUBLIC_DIR) && fs.existsSync(requestedFilePath)) {
    serveFile(res, requestedFilePath);
    return;
  }

  sendJson(res, 404, { success: false, message: 'الصفحة غير موجودة' });
});

server.listen(PORT, () => {
  console.log(`POS cashier app running at http://localhost:${PORT}`);
  hydrateFromSupabase();
});
