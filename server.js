const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// ==================== DANH SÁCH CLIENT ====================
let employees = [];     // Lưu socketId của nhân viên (cũ)
let waiters = [];       // Lưu { socketId, userId, branchId }
let customers = [];     // Lưu { socketId, tableId, tableNumber, branchId }
let kitchens = [];      // Lưu { socketId, branchId, userId }
let admins = [];        // Lưu { socketId, userId }
let managers = [];      // Lưu { socketId, userId, branchId }
let cashiers = [];      // Lưu { socketId, userId, branchId }

// ==================== SOCKET CONNECTION ====================
io.on('connection', (socket) => {
  console.log('📡 Client connected:', socket.id);

  // ========== REGISTER CUSTOMER ==========
  socket.on('register-customer', (tableData) => {
    const customerInfo = {
      socketId: socket.id,
      tableId: tableData.id,
      tableNumber: tableData.number,
      branchId: tableData.branchId
    };

    customers = customers.filter(c => c.socketId !== socket.id);
    customers.push(customerInfo);

    console.log(`👤 Customer registered: Socket ${socket.id} - Table ${tableData.number} - Branch ${tableData.branchId}`);
    console.log(`👥 Total customers: ${customers.length}`);
  });

  // ========== REGISTER ROLE ==========
  socket.on('register-role', (data) => {
    // Backward compatibility
    if (typeof data === 'string') {
      const role = data;
      if (role === 'employee') employees.push(socket.id);
      if (role === 'customer') customers.push({ socketId: socket.id, tableId: null, tableNumber: null, branchId: null });
      if (role === 'kitchen') kitchens.push({ socketId: socket.id, branchId: null, userId: null });
      if (role === 'waiter') waiters.push({ socketId: socket.id, userId: null, branchId: null });
      if (role === 'cashier') cashiers.push({ socketId: socket.id, userId: null, branchId: null });
      console.log(`${role} connected: ${socket.id}`);
      return;
    }

    const { role, userId, branchId } = data;

    console.log(`📥 Register role received:`, { role, userId, branchId, socketId: socket.id });

    // Xóa đăng ký cũ
    employees = employees.filter(id => id !== socket.id);
    waiters = waiters.filter(w => w.socketId !== socket.id);
    customers = customers.filter(c => c.socketId !== socket.id);
    kitchens = kitchens.filter(k => k.socketId !== socket.id);
    admins = admins.filter(a => a.socketId !== socket.id);
    managers = managers.filter(m => m.socketId !== socket.id);
    cashiers = cashiers.filter(c => c.socketId !== socket.id);

    switch (role) {
      case 'employee':
        employees.push(socket.id);
        console.log(`👔 Employee connected: ${socket.id}`);
        break;
      case 'waiter':
        waiters.push({ socketId: socket.id, userId, branchId });
        console.log(`🍽️ Waiter connected: ${socket.id}, UserID: ${userId}, Branch: ${branchId}`);
        break;
      case 'customer':
        customers.push({ socketId: socket.id, tableId: null, tableNumber: null, branchId });
        console.log(`👤 Customer connected: ${socket.id}, Branch: ${branchId}`);
        break;
      case 'kitchen':
        kitchens.push({ socketId: socket.id, branchId, userId });
        console.log(`👨‍🍳 Kitchen connected: ${socket.id}, Branch: ${branchId}, UserID: ${userId}`);
        break;
      case 'admin':
        admins.push({ socketId: socket.id, userId });
        console.log(`👨‍💼 Admin connected: ${socket.id}, UserID: ${userId}`);
        break;
      case 'manager':
        managers.push({ socketId: socket.id, userId, branchId });
        console.log(`👨‍💼 Manager connected: ${socket.id}, UserID: ${userId}, Branch: ${branchId}`);
        break;
      case 'cashier':
        cashiers.push({ socketId: socket.id, userId, branchId });
        console.log(`💰 Cashier connected: ${socket.id}, UserID: ${userId}, Branch: ${branchId}`);
        break;
      default:
        console.log(`⚠️ Unknown role: ${role}`);
    }

    console.log(`👥 Total - Admins: ${admins.length}, Managers: ${managers.length}, Waiters: ${waiters.length}, Cashiers: ${cashiers.length}, Employees: ${employees.length}, Kitchens: ${kitchens.length}, Customers: ${customers.length}`);
  });

  // ==================== INVENTORY EVENTS ====================

  socket.on('inventory-request-created', (requestData) => {
    console.log('📦 Manager created new inventory request:', requestData);

    admins.forEach((admin) => {
      io.to(admin.socketId).emit('new-inventory-request', {
        ...requestData,
        timestamp: new Date().toISOString()
      });
      console.log(`Sent notification to Admin: ${admin.socketId}`);
    });

    console.log(`Sent to ${admins.length} admin(s)`);
  });

  socket.on('inventory-request-approved', (approvalData) => {
    console.log('✅ Admin approved request:', approvalData);

    const affectedManagers = managers.filter(m => m.branchId === approvalData.branchId);

    affectedManagers.forEach((manager) => {
      io.to(manager.socketId).emit('inventory-request-status-changed', {
        ...approvalData,
        status: 'APPROVED',
        timestamp: new Date().toISOString()
      });
      console.log(`Sent approval to Manager: ${manager.socketId}`);
    });

    io.emit('inventory-updated', {
      branchId: approvalData.branchId,
      timestamp: new Date().toISOString()
    });

    console.log(`Sent approval to ${affectedManagers.length} manager(s)`);
  });

  socket.on('inventory-request-rejected', (rejectionData) => {
    console.log('❌ Admin rejected request:', rejectionData);

    const affectedManagers = managers.filter(m => m.branchId === rejectionData.branchId);

    affectedManagers.forEach((manager) => {
      io.to(manager.socketId).emit('inventory-request-status-changed', {
        ...rejectionData,
        status: 'REJECTED',
        timestamp: new Date().toISOString()
      });
      console.log(`Sent rejection to Manager: ${manager.socketId}`);
    });

    console.log(`Sent rejection to ${affectedManagers.length} manager(s)`);
  });

  socket.on('branch-inventory-updated', (data) => {
    console.log('📊 Branch inventory updated:', data);

    const affectedManagers = managers.filter(m => m.branchId === data.branchId);
    affectedManagers.forEach((manager) => {
      io.to(manager.socketId).emit('inventory-stock-changed', data);
    });

    admins.forEach((admin) => {
      io.to(admin.socketId).emit('inventory-stock-changed', data);
    });
  });

  // ==================== ORDER EVENTS ====================

  // ===== ĐƠN HÀNG MỚI =====
  socket.on("new-order", (orderData) => {
    console.log("=========================================");
    console.log("🆕 [SERVER] New order received:");
    console.log(`📦 Order #${orderData.orderId}`);
    console.log(`📌 Branch ID: ${orderData.branchId}`);
    console.log(`📍 Location: ${orderData.locationName}`);
    console.log(`Items: ${orderData.items?.length || 0}`);
    console.log("=========================================");

    // Gửi đến KITCHEN cùng branch
    const targetKitchens = kitchens.filter(k => Number(k.branchId) === Number(orderData.branchId));
    console.log(`👨‍🍳 Sending to ${targetKitchens.length} kitchen(s)`);
    targetKitchens.forEach((kitchen) => {
      io.to(kitchen.socketId).emit("new-order", orderData);
    });

    // Gửi đến WAITER cùng branch
    const targetWaiters = waiters.filter(w => w.branchId === orderData.branchId);
    console.log(`🍽️ Sending to ${targetWaiters.length} waiter(s)`);
    targetWaiters.forEach((waiter) => {
      io.to(waiter.socketId).emit("new-order", orderData);
    });

    // Gửi đến CASHIER cùng branch
    const targetCashiers = cashiers.filter(c => c.branchId === orderData.branchId);
    console.log(`💰 Sending to ${targetCashiers.length} cashier(s)`);
    targetCashiers.forEach((cashier) => {
      io.to(cashier.socketId).emit("new-order", orderData);
    });

    // Gửi đến EMPLOYEES
    employees.forEach((empId) => {
      io.to(empId).emit("new-order", orderData);
    });

    console.log(`TOTAL: ${targetKitchens.length} kitchen(s), ${targetWaiters.length} waiter(s), ${targetCashiers.length} cashier(s), ${employees.length} employee(s)`);
  });

  // ===== CẬP NHẬT ĐƠN HÀNG (THÊM MÓN) =====
  socket.on("order-updated", (orderData) => {
    console.log("=========================================");
    console.log("🔄 [SERVER] Order updated (add items):");
    console.log(`📦 Order #${orderData.orderId}`);
    console.log(`📌 Branch ID: ${orderData.branchId}`);
    console.log(`📍 Location: ${orderData.locationName}`);
    console.log(`New items: ${orderData.items?.length || 0}`);
    console.log("=========================================");

    // Debug kitchens
    console.log("👨‍🍳 All registered kitchens:");
    kitchens.forEach(k => {
      console.log(`   - Socket: ${k.socketId}, Branch: ${k.branchId}, UserID: ${k.userId}`);
    });

    // Gửi đến KITCHEN - DÙNG ĐÚNG EVENT "order-updated"
    const targetKitchens = kitchens.filter(k => k.branchId === orderData.branchId);
    console.log(`👨‍🍳 Kitchens matching branch ${orderData.branchId}: ${targetKitchens.length}`);
    targetKitchens.forEach((kitchen) => {
      console.log(`Sending order-updated to Kitchen: ${kitchen.socketId}`);
      io.to(kitchen.socketId).emit("order-updated", orderData);
    });

    // Gửi đến WAITER
    const targetWaiters = waiters.filter(w => w.branchId === orderData.branchId);
    console.log(`🍽️ Waiters matching: ${targetWaiters.length}`);
    targetWaiters.forEach((waiter) => {
      io.to(waiter.socketId).emit("order-updated", orderData);
    });

    // Gửi đến CASHIER
    const targetCashiers = cashiers.filter(c => c.branchId === orderData.branchId);
    console.log(`💰 Cashiers matching: ${targetCashiers.length}`);
    targetCashiers.forEach((cashier) => {
      io.to(cashier.socketId).emit("order-updated", orderData);
    });

    // Gửi đến EMPLOYEES
    employees.forEach((empId) => {
      io.to(empId).emit("order-updated", orderData);
    });

    console.log(`TOTAL: ${targetKitchens.length} kitchen(s), ${targetWaiters.length} waiter(s), ${targetCashiers.length} cashier(s), ${employees.length} employee(s)`);
  });

  socket.on("payment-success", (data) => {
    // Broadcast đến tất cả users trong cùng branch
    io.emit("payment-success", data);
  });

  // ===== CẬP NHẬT TRẠNG THÁI ĐƠN HÀNG =====
  socket.on("order-status-changed", (data) => {
    console.log("=========================================");
    console.log("🔔 [SERVER] Order status changed:");
    console.log(`📦 Order #${data.orderId} → ${data.newStatus}`);
    console.log(`🪑 Table: ${data.tableNumber}`);
    console.log(`📌 Branch: ${data.branchId}`);
    console.log("=========================================");

    // Gửi cho KHÁCH HÀNG ở bàn đó
    const affectedCustomers = customers.filter(c => c.tableNumber === data.tableNumber);
    affectedCustomers.forEach((customer) => {
      io.to(customer.socketId).emit("order-status-notification", {
        orderId: data.orderId,
        tableNumber: data.tableNumber,
        oldStatus: data.oldStatus,
        newStatus: data.newStatus,
        message: data.message,
        timestamp: new Date().toISOString()
      });
    });

    // Gửi cho WAITER
    const targetWaiters = waiters.filter(w => w.branchId === data.branchId);
    targetWaiters.forEach((waiter) => {
      io.to(waiter.socketId).emit("update-order-status", data);
    });

    // Gửi cho CASHIER
    const targetCashiers = cashiers.filter(c => c.branchId === data.branchId);
    targetCashiers.forEach((cashier) => {
      io.to(cashier.socketId).emit("update-order-status", data);
    });

    // Gửi cho KITCHEN
    const targetKitchens = kitchens.filter(k => k.branchId === data.branchId);
    targetKitchens.forEach((kitchen) => {
      io.to(kitchen.socketId).emit("update-order-status", data);
    });

    // Gửi cho EMPLOYEES
    employees.forEach((empId) => {
      io.to(empId).emit("update-order-status", data);
    });

    // Cập nhật bàn
    io.emit("update-tables");

    console.log(`Sent to ${targetWaiters.length} waiter(s), ${targetCashiers.length} cashier(s), ${targetKitchens.length} kitchen(s), ${employees.length} employee(s)`);
  });

  // ===== BẾP CẬP NHẬT TRẠNG THÁI MÓN =====
  socket.on("update-order-item-status", (itemData) => {
    console.log("=========================================");
    console.log("👨‍🍳 [SERVER] Kitchen updated item status:");
    console.log(`${itemData.itemName} → ${itemData.status}`);
    console.log(`📌 Branch: ${itemData.branchId}`);
    console.log(`🆔 Items: ${itemData.items?.join(', ')}`);
    console.log(`🪑 Tables: ${itemData.tables?.join(', ')}`);
    console.log("=========================================");

    // Gửi cho WAITER
    const targetWaiters = waiters.filter(w => w.branchId === itemData.branchId);
    console.log(`🍽️ Sending to ${targetWaiters.length} waiter(s)`);
    targetWaiters.forEach((waiter) => {
      io.to(waiter.socketId).emit("update-order-item-status", itemData);
    });

    // Gửi cho CASHIER
    const targetCashiers = cashiers.filter(c => c.branchId === itemData.branchId);
    console.log(`💰 Sending to ${targetCashiers.length} cashier(s)`);
    targetCashiers.forEach((cashier) => {
      io.to(cashier.socketId).emit("update-order-item-status", itemData);
    });

    // Gửi cho EMPLOYEES
    employees.forEach((empId) => {
      io.to(empId).emit("update-order-item-status", itemData);
    });

    // Gửi cho KITCHEN khác (đồng bộ)
    const otherKitchens = kitchens.filter(k => k.branchId === itemData.branchId && k.socketId !== socket.id);
    otherKitchens.forEach((kitchen) => {
      io.to(kitchen.socketId).emit("update-order-item-status", itemData);
    });

    console.log(`TOTAL: ${targetWaiters.length} waiter(s), ${targetCashiers.length} cashier(s), ${otherKitchens.length} other kitchen(s), ${employees.length} employee(s)`);
  });

  // ===== BẾP CẬP NHẬT TRẠNG THÁI MÓN (CHO WAITER) =====
  socket.on("kitchen-item-status-changed", (itemData) => {
    console.log("=========================================");
    console.log("👨‍🍳 [SERVER] Kitchen item status changed (waiter notification):");
    console.log(`📝 Message: ${itemData.message}`);
    console.log(`📌 Branch: ${itemData.branchId}`);
    console.log(`Status: ${itemData.status} - ${itemData.itemName}`);
    console.log("=========================================");

    // Gửi cho WAITER
    const targetWaiters = waiters.filter(w => w.branchId === itemData.branchId);
    console.log(`🍽️ Sending to ${targetWaiters.length} waiter(s)`);
    targetWaiters.forEach((waiter) => {
      io.to(waiter.socketId).emit("kitchen-item-status-changed", itemData);
    });

    // Gửi cho CASHIER
    const targetCashiers = cashiers.filter(c => c.branchId === itemData.branchId);
    console.log(`💰 Sending to ${targetCashiers.length} cashier(s)`);
    targetCashiers.forEach((cashier) => {
      io.to(cashier.socketId).emit("kitchen-item-status-changed", itemData);
    });

    // Gửi cho EMPLOYEES
    employees.forEach((empId) => {
      io.to(empId).emit("kitchen-item-status-changed", itemData);
    });

    // Gửi cho KITCHEN khác (đồng bộ)
    const otherKitchens = kitchens.filter(k => k.branchId === itemData.branchId && k.socketId !== socket.id);
    otherKitchens.forEach((kitchen) => {
      io.to(kitchen.socketId).emit("kitchen-item-status-changed", itemData);
    });

    console.log(`TOTAL: ${targetWaiters.length} waiter(s), ${targetCashiers.length} cashier(s), ${otherKitchens.length} other kitchen(s), ${employees.length} employee(s)`);
  });

  // ==================== TABLE EVENTS ====================

  socket.on("update-tables", () => {
    console.log("📣 Update tables requested from:", socket.id);
    io.emit("update-tables");
  });

  // ==================== RESERVATION EVENTS ====================

  socket.on("reservation-upcoming", (data) => {
    console.log("📅 Reservation upcoming:", data);

    const targetKitchens = kitchens.filter(k => k.branchId === data.branchId);
    targetKitchens.forEach((kitchen) => {
      io.to(kitchen.socketId).emit("reservation-upcoming", data);
    });

    const targetWaiters = waiters.filter(w => w.branchId === data.branchId);
    targetWaiters.forEach((waiter) => {
      io.to(waiter.socketId).emit("reservation-upcoming", data);
    });

    console.log(`Sent reservation to ${targetKitchens.length} kitchen(s), ${targetWaiters.length} waiter(s)`);
  });

  // ==================== DISCONNECT ====================
  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);

    const wasEmployee = employees.includes(socket.id);
    const wasWaiter = waiters.some(w => w.socketId === socket.id);
    const wasCustomer = customers.some(c => c.socketId === socket.id);
    const wasKitchen = kitchens.some(k => k.socketId === socket.id);
    const wasAdmin = admins.some(a => a.socketId === socket.id);
    const wasManager = managers.some(m => m.socketId === socket.id);
    const wasCashier = cashiers.some(c => c.socketId === socket.id);

    employees = employees.filter(id => id !== socket.id);
    waiters = waiters.filter(w => w.socketId !== socket.id);
    customers = customers.filter(c => c.socketId !== socket.id);
    kitchens = kitchens.filter(k => k.socketId !== socket.id);
    admins = admins.filter(a => a.socketId !== socket.id);
    managers = managers.filter(m => m.socketId !== socket.id);
    cashiers = cashiers.filter(c => c.socketId !== socket.id);

    if (wasAdmin) console.log('  - Removed Admin');
    if (wasManager) console.log('  - Removed Manager');
    if (wasWaiter) console.log('  - Removed Waiter');
    if (wasCashier) console.log('  - Removed Cashier');
    if (wasEmployee) console.log('  - Removed Employee');
    if (wasKitchen) console.log('  - Removed Kitchen');
    if (wasCustomer) console.log('  - Removed Customer');

    console.log(`👥 Remaining - Admins: ${admins.length}, Managers: ${managers.length}, Waiters: ${waiters.length}, Cashiers: ${cashiers.length}, Employees: ${employees.length}, Kitchens: ${kitchens.length}, Customers: ${customers.length}`);
  });
});

app.post('/notify-staff-reservation', (req, res) => {

  const data = req.body;

  console.log('📅 Reservation Notification:', data);

  const branchIdNum = Number(data.branchId);
  const targetWaiters = waiters.filter(w => Number(w.branchId) === branchIdNum);
  const targetCashiers = cashiers.filter(c => Number(c.branchId) === branchIdNum);

  targetWaiters.forEach(waiter => {
    io.to(waiter.socketId)
      .emit('staff-reservation-notification', data);
  });

  targetCashiers.forEach(cashier => {
    io.to(cashier.socketId)
      .emit('staff-reservation-notification', data);
  });

  console.log(
    `Sent to ${targetWaiters.length} waiter(s), ${targetCashiers.length} cashier(s)`
  );

  res.json({
    success: true
  });
});

app.post('/notify-kitchen-reservation', (req, res) => {

  const data = req.body;
  console.log('Kitchen Reservation Notification, branchId:', data.branchId);

  const branchIdNum = Number(data.branchId);
  const targetKitchens = kitchens.filter(k => Number(k.branchId) === branchIdNum);

  console.log(`Found ${targetKitchens.length} kitchen(s) for branch ${branchIdNum}`);
  console.log('All kitchens:', kitchens.map(k => ({ branchId: k.branchId, socketId: k.socketId })));

  targetKitchens.forEach(kitchen => {

    io.to(kitchen.socketId)
      .emit(
        'reservation-upcoming',
        data
      );
  });

  console.log(
    `Sent to ${targetKitchens.length} kitchen(s)`
  );

  res.json({
    success: true
  });
});

app.post('/notify-new-order', (req, res) => {
  const data = req.body;

  const branchIdNum = Number(data.branchId);
  console.log('🔔 notify-new-order received, branchId:', data.branchId, '→', branchIdNum);
  console.log('👨‍🍳 All kitchens:', kitchens.map(k => ({ branchId: k.branchId, type: typeof k.branchId })));

  const targetKitchens = kitchens.filter(k => Number(k.branchId) === branchIdNum);
  console.log('✅ Matched kitchens:', targetKitchens.length);
  targetKitchens.forEach(kitchen => {
    io.to(kitchen.socketId).emit('new-order', data);
  });

  const targetWaiters = waiters.filter(w => Number(w.branchId) === branchIdNum);
  targetWaiters.forEach(waiter => {
    io.to(waiter.socketId).emit('new-order', data);
  });

  const targetCashiers = cashiers.filter(c => Number(c.branchId) === branchIdNum);
  targetCashiers.forEach(cashier => {
    io.to(cashier.socketId).emit('new-order', data);
  });

  io.emit('update-tables');
  res.json({ success: true });
});

// ==================== START SERVER ====================
const PORT = process.env.SOCKET_PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Socket.IO server đang chạy tại http://localhost:${PORT}`);
  console.log(`Waiting for connections...`);
  console.log(`👥 Roles supported: admin, manager, waiter, cashier, employee, kitchen, customer`);
  console.log(`📡 CORS enabled for: http://localhost:3000`);
});