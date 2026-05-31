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
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// ==================== DANH SÁCH CLIENT ====================
// Lưu trữ thông tin các client kết nối
let employees = [];     // Lưu socketId của nhân viên (cũ)
let waiters = [];       // Lưu { socketId, userId, branchId } - Phục vụ
let customers = [];     // Lưu { socketId, tableId, tableNumber, branchId }
let kitchens = [];      // Lưu { socketId, branchId, userId }
let admins = [];        // Lưu { socketId, userId }
let managers = [];      // Lưu { socketId, userId, branchId }

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

    // Xóa đăng ký cũ nếu có
    customers = customers.filter(c => c.socketId !== socket.id);

    // Thêm đăng ký mới
    customers.push(customerInfo);

    console.log(`👤 Customer registered: Socket ${socket.id} - Table ${tableData.number} - Branch ${tableData.branchId}`);
    console.log(`👥 Total customers: ${customers.length}`);
  });

  // ========== REGISTER ROLE ==========
  socket.on('register-role', (data) => {
    // Xử lý trường hợp data là string (backward compatibility)
    if (typeof data === 'string') {
      const role = data;
      if (role === 'employee') employees.push(socket.id);
      if (role === 'customer') customers.push({ socketId: socket.id, tableId: null, tableNumber: null, branchId: null });
      if (role === 'kitchen') kitchens.push({ socketId: socket.id, branchId: null, userId: null });
      if (role === 'waiter') waiters.push({ socketId: socket.id, userId: null, branchId: null });
      console.log(`📋 ${role} connected: ${socket.id}`);
      return;
    }

    // Xử lý trường hợp data là object
    const { role, userId, branchId } = data;

    console.log(`📥 Register role received:`, { role, userId, branchId });

    // Xóa đăng ký cũ trước khi thêm mới
    employees = employees.filter(id => id !== socket.id);
    waiters = waiters.filter(w => w.socketId !== socket.id);
    customers = customers.filter(c => c.socketId !== socket.id);
    kitchens = kitchens.filter(k => k.socketId !== socket.id);
    admins = admins.filter(a => a.socketId !== socket.id);
    managers = managers.filter(m => m.socketId !== socket.id);

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
        console.log(`👨‍🍳 Kitchen connected: ${socket.id}, Branch: ${branchId}`);
        break;
      case 'admin':
        admins.push({ socketId: socket.id, userId });
        console.log(`👨‍💼 Admin connected: ${socket.id}, UserID: ${userId}`);
        break;
      case 'manager':
        managers.push({ socketId: socket.id, userId, branchId });
        console.log(`👨‍💼 Manager connected: ${socket.id}, UserID: ${userId}, Branch: ${branchId}`);
        break;
      default:
        console.log(`⚠️ Unknown role: ${role}`);
    }

    console.log(`👥 Total - Admins: ${admins.length}, Managers: ${managers.length}, Waiters: ${waiters.length}, Employees: ${employees.length}, Kitchens: ${kitchens.length}, Customers: ${customers.length}`);
  });

  // ==================== INVENTORY REQUEST EVENTS ====================

  // Manager tạo yêu cầu → Gửi thông báo cho Admin
  socket.on('inventory-request-created', (requestData) => {
    console.log('📦 Manager created new inventory request:', requestData);

    // Gửi thông báo cho TẤT CẢ Admin
    admins.forEach((admin) => {
      io.to(admin.socketId).emit('new-inventory-request', {
        ...requestData,
        timestamp: new Date().toISOString()
      });
      console.log(`Sent notification to Admin: ${admin.socketId}`);
    });

    console.log(`📤 Sent to ${admins.length} admin(s)`);
  });

  // Admin duyệt yêu cầu → Gửi thông báo cho Manager
  socket.on('inventory-request-approved', (approvalData) => {
    console.log('✅ Admin approved request:', approvalData);

    // Tìm manager của chi nhánh đó
    const affectedManagers = managers.filter(m => m.branchId === approvalData.branchId);

    // Gửi thông báo cho Manager
    affectedManagers.forEach((manager) => {
      io.to(manager.socketId).emit('inventory-request-status-changed', {
        ...approvalData,
        status: 'APPROVED',
        timestamp: new Date().toISOString()
      });
      console.log(`Sent approval to Manager: ${manager.socketId}`);
    });

    // Broadcast inventory updated
    io.emit('inventory-updated', {
      branchId: approvalData.branchId,
      timestamp: new Date().toISOString()
    });

    console.log(`📤 Sent approval to ${affectedManagers.length} manager(s)`);
  });

  // Admin từ chối yêu cầu → Gửi thông báo cho Manager
  socket.on('inventory-request-rejected', (rejectionData) => {
    console.log('❌ Admin rejected request:', rejectionData);

    // Tìm manager của chi nhánh đó
    const affectedManagers = managers.filter(m => m.branchId === rejectionData.branchId);

    // Gửi thông báo cho Manager
    affectedManagers.forEach((manager) => {
      io.to(manager.socketId).emit('inventory-request-status-changed', {
        ...rejectionData,
        status: 'REJECTED',
        timestamp: new Date().toISOString()
      });
      console.log(`Sent rejection to Manager: ${manager.socketId}`);
    });

    console.log(`📤 Sent rejection to ${affectedManagers.length} manager(s)`);
  });

  // Cập nhật tồn kho real-time
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

  // Đơn hàng mới từ quầy/phục vụ
  socket.on("new-order", (orderData) => {
    console.log("🆕 New order received:", orderData);
    console.log(`📌 Branch ID: ${orderData.branchId}`);

    // Gửi đến kitchen có cùng branchId
    const targetKitchens = kitchens.filter(k => k.branchId === orderData.branchId);

    console.log(`📤 Sending to ${targetKitchens.length} kitchen(s) in branch ${orderData.branchId}`);

    targetKitchens.forEach((kitchen) => {
      io.to(kitchen.socketId).emit("new-order", orderData);
    });

    // Gửi cho waiters cùng branch (để đồng bộ)
    const targetWaiters = waiters.filter(w => w.branchId === orderData.branchId);

    targetWaiters.forEach((waiter) => {
      io.to(waiter.socketId).emit("new-order", orderData);
    });

    // Gửi cho employees
    employees.forEach((empId) => {
      io.to(empId).emit("new-order", orderData);
    });

    console.log(`📤 Sent to ${targetKitchens.length} kitchen(s), ${targetWaiters.length} waiter(s), ${employees.length} employee(s)`);
  });

  // Cập nhật đơn hàng (thêm món)
  socket.on("order-updated", (orderData) => {
    console.log("🔄 Order updated (add items):", orderData);
    console.log(`📌 Branch ID: ${orderData.branchId}`);

    // Gửi đến kitchen có cùng branchId
    const targetKitchens = kitchens.filter(k => k.branchId === orderData.branchId);

    console.log(`📤 Sending to ${targetKitchens.length} kitchen(s) in branch ${orderData.branchId}`);

    targetKitchens.forEach((kitchen) => {
      io.to(kitchen.socketId).emit("update-order-status", orderData);
    });

    // Gửi cho waiters cùng branch
    const targetWaiters = waiters.filter(w => w.branchId === orderData.branchId);

    targetWaiters.forEach((waiter) => {
      io.to(waiter.socketId).emit("order-updated", orderData);
    });

    // Gửi cho employees
    employees.forEach((empId) => {
      io.to(empId).emit("order-updated", orderData);
    });

    console.log(`📤 Sent to ${targetKitchens.length} kitchen(s), ${targetWaiters.length} waiter(s), ${employees.length} employee(s)`);
  });

  // Nhân viên cập nhật trạng thái đơn hàng
  socket.on("order-status-changed", (data) => {
    console.log("🔔 Order status changed:", data);
    console.log(`📦 Order #${data.orderId} - Table ${data.tableNumber} → ${data.newStatus}`);

    // Tìm khách hàng đang ngồi ở bàn đó
    const affectedCustomers = customers.filter(c => c.tableNumber === data.tableNumber);

    console.log(`👥 Found ${affectedCustomers.length} customer(s) at table ${data.tableNumber}`);

    // Gửi thông báo cho khách hàng
    affectedCustomers.forEach((customer) => {
      io.to(customer.socketId).emit("order-status-notification", {
        orderId: data.orderId,
        tableNumber: data.tableNumber,
        oldStatus: data.oldStatus,
        newStatus: data.newStatus,
        message: data.message,
        timestamp: new Date().toISOString()
      });
      console.log(`📤 Sent notification to customer ${customer.socketId}`);
    });

    // Gửi cho waiters cùng branch
    const targetWaiters = waiters.filter(w => w.branchId === data.branchId);

    targetWaiters.forEach((waiter) => {
      io.to(waiter.socketId).emit("update-order-status", data);
    });

    // Gửi cho employees
    employees.forEach((empId) => {
      io.to(empId).emit("update-order-status", data);
    });

    // Gửi cho kitchens cùng branch
    const targetKitchens = kitchens.filter(k => k.branchId === data.branchId);

    targetKitchens.forEach((kitchen) => {
      io.to(kitchen.socketId).emit("update-order-status", data);
    });

    // Cập nhật trạng thái bàn
    io.emit("update-tables");

    console.log(`📤 Sent to ${targetWaiters.length} waiter(s), ${employees.length} employee(s), ${targetKitchens.length} kitchen(s)`);
  });

  // ===== KHI BẾP CẬP NHẬT TRẠNG THÁI MÓN (BẮT ĐẦU NẤU / HOÀN THÀNH) =====
  socket.on("update-order-item-status", (itemData) => {
    console.log("=========================================");
    console.log("👨‍🍳 [SERVER] Bếp cập nhật trạng thái món:");
    console.log("📦 Full data:", JSON.stringify(itemData, null, 2));
    console.log(`📌 Branch ID: ${itemData.branchId}`);
    console.log(`📋 Status: ${itemData.status} - ${itemData.itemName}`);
    console.log(`🆔 Items: ${itemData.items?.join(', ')}`);
    console.log(`🪑 Tables: ${itemData.tables?.join(', ')}`);

    // Log danh sách waiters hiện tại
    console.log("👥 Current waiters in system:");
    waiters.forEach(w => {
      console.log(`   - Socket: ${w.socketId}, UserID: ${w.userId}, Branch: ${w.branchId}`);
    });

    // ===== GỬI CHO WAITERS CÙNG CHI NHÁNH =====
    const targetWaiters = waiters.filter(w => w.branchId === itemData.branchId);
    console.log(`🎯 Target waiters for branch ${itemData.branchId}: ${targetWaiters.length}`);

    if (targetWaiters.length === 0) {
      console.log("⚠️ [SERVER] No waiters found for branch", itemData.branchId);
    }

    targetWaiters.forEach((waiter) => {
      console.log(`📤 [SERVER] Sending to Waiter: ${waiter.socketId} (UserID: ${waiter.userId})`);
      io.to(waiter.socketId).emit("update-order-item-status", itemData);
    });

    // ===== GỬI CHO EMPLOYEES =====
    console.log(`👥 Employees count: ${employees.length}`);
    employees.forEach((empId) => {
      console.log(`📤 [SERVER] Sending to Employee: ${empId}`);
      io.to(empId).emit("update-order-item-status", itemData);
    });

    // ===== GỬI CHO CÁC BẾP KHÁC TRONG CÙNG CHI NHÁNH ĐỂ ĐỒNG BỘ =====
    const targetKitchens = kitchens.filter(k => k.branchId === itemData.branchId && k.socketId !== socket.id);
    console.log(`👨‍🍳 Other kitchens in branch: ${targetKitchens.length}`);

    targetKitchens.forEach((kitchen) => {
      console.log(`📤 [SERVER] Sending to Kitchen: ${kitchen.socketId}`);
      io.to(kitchen.socketId).emit("update-order-item-status", itemData);
    });

    console.log(`📤 [SERVER] TOTAL sent: ${targetWaiters.length} waiter(s), ${employees.length} employee(s), ${targetKitchens.length} kitchen(s)`);
    console.log("=========================================");
  });

  // ===== KHI BẾP CẬP NHẬT TRẠNG THÁI MÓN (CHO WAITER - THÊM MỚI) =====
  socket.on("kitchen-item-status-changed", (itemData) => {
    console.log("=========================================");
    console.log("👨‍🍳 [SERVER] Kitchen item status changed (for waiter):");
    console.log("📦 Full data:", JSON.stringify(itemData, null, 2));
    console.log(`📌 Branch ID: ${itemData.branchId}`);
    console.log(`📋 Status: ${itemData.status} - ${itemData.itemName}`);
    console.log(`📝 Message: ${itemData.message}`);
    console.log(`🆔 Items: ${itemData.items?.join(', ')}`);
    console.log(`🪑 Tables: ${itemData.tables?.join(', ')}`);

    // Log danh sách waiters hiện tại
    console.log("👥 Current waiters in system:");
    waiters.forEach(w => {
      console.log(`   - Socket: ${w.socketId}, UserID: ${w.userId}, Branch: ${w.branchId}`);
    });

    // ===== GỬI CHO WAITERS CÙNG CHI NHÁNH =====
    const targetWaiters = waiters.filter(w => w.branchId === itemData.branchId);
    console.log(`🎯 Target waiters for branch ${itemData.branchId}: ${targetWaiters.length}`);

    if (targetWaiters.length === 0) {
      console.log("⚠️ [SERVER] No waiters found for branch", itemData.branchId);
      // Log tất cả waiters để debug
      console.log("👥 All registered waiters:", JSON.stringify(waiters, null, 2));
    }

    targetWaiters.forEach((waiter) => {
      console.log(`📤 [SERVER] Sending kitchen-item-status-changed to Waiter: ${waiter.socketId} (UserID: ${waiter.userId})`);
      io.to(waiter.socketId).emit("kitchen-item-status-changed", itemData);
    });

    // ===== GỬI CHO EMPLOYEES =====
    console.log(`👥 Employees count: ${employees.length}`);
    employees.forEach((empId) => {
      console.log(`📤 [SERVER] Sending kitchen-item-status-changed to Employee: ${empId}`);
      io.to(empId).emit("kitchen-item-status-changed", itemData);
    });

    // ===== GỬI CHO CÁC BẾP KHÁC TRONG CÙNG CHI NHÁNH ĐỂ ĐỒNG BỘ =====
    const targetKitchens = kitchens.filter(k => k.branchId === itemData.branchId && k.socketId !== socket.id);
    console.log(`👨‍🍳 Other kitchens in branch: ${targetKitchens.length}`);

    targetKitchens.forEach((kitchen) => {
      console.log(`📤 [SERVER] Sending kitchen-item-status-changed to Kitchen: ${kitchen.socketId}`);
      io.to(kitchen.socketId).emit("kitchen-item-status-changed", itemData);
    });

    console.log(`📤 [SERVER] TOTAL sent kitchen-item-status-changed: ${targetWaiters.length} waiter(s), ${employees.length} employee(s), ${targetKitchens.length} kitchen(s)`);
    console.log("=========================================");
  });

  // ==================== TABLE EVENTS ====================

  // Cập nhật trạng thái bàn
  socket.on("update-tables", () => {
    console.log("📣 Update tables requested from:", socket.id);
    io.emit("update-tables");
  });

  // ==================== RESERVATION EVENTS ====================

  // Đặt bàn trước
  socket.on("reservation-upcoming", (data) => {
    console.log("📅 Reservation upcoming:", data);

    // Gửi cho kitchens cùng branch
    const targetKitchens = kitchens.filter(k => k.branchId === data.branchId);

    targetKitchens.forEach((kitchen) => {
      io.to(kitchen.socketId).emit("reservation-upcoming", data);
    });

    // Gửi cho waiters cùng branch
    const targetWaiters = waiters.filter(w => w.branchId === data.branchId);

    targetWaiters.forEach((waiter) => {
      io.to(waiter.socketId).emit("reservation-upcoming", data);
    });

    console.log(`📤 Sent reservation to ${targetKitchens.length} kitchen(s), ${targetWaiters.length} waiter(s)`);
  });

  // ==================== DISCONNECT ====================
  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);

    // Kiểm tra và xóa khỏi các danh sách
    const wasEmployee = employees.includes(socket.id);
    const wasWaiter = waiters.some(w => w.socketId === socket.id);
    const wasCustomer = customers.some(c => c.socketId === socket.id);
    const wasKitchen = kitchens.some(k => k.socketId === socket.id);
    const wasAdmin = admins.some(a => a.socketId === socket.id);
    const wasManager = managers.some(m => m.socketId === socket.id);

    // Xóa khỏi tất cả các mảng
    employees = employees.filter(id => id !== socket.id);
    waiters = waiters.filter(w => w.socketId !== socket.id);
    customers = customers.filter(c => c.socketId !== socket.id);
    kitchens = kitchens.filter(k => k.socketId !== socket.id);
    admins = admins.filter(a => a.socketId !== socket.id);
    managers = managers.filter(m => m.socketId !== socket.id);

    if (wasAdmin) console.log('  - Removed Admin');
    if (wasManager) console.log('  - Removed Manager');
    if (wasWaiter) console.log('  - Removed Waiter');
    if (wasEmployee) console.log('  - Removed Employee');
    if (wasKitchen) console.log('  - Removed Kitchen');
    if (wasCustomer) console.log('  - Removed Customer');

    console.log(`👥 Remaining - Admins: ${admins.length}, Managers: ${managers.length}, Waiters: ${waiters.length}, Employees: ${employees.length}, Kitchens: ${kitchens.length}, Customers: ${customers.length}`);
  });
});

// ==================== START SERVER ====================
const PORT = 3001;
server.listen(PORT, () => {
  console.log(`🚀 Socket.IO server đang chạy tại http://localhost:${PORT}`);
  console.log(`📋 Waiting for connections...`);
  console.log(`👥 Roles supported: admin, manager, waiter, employee, kitchen, customer`);
});