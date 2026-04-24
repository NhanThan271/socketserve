const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Danh sách client
let employees = [];
let customers = [];
let kitchens = [];
let admins = [];
let managers = [];

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

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

    console.log(`👤 Customer registered: Socket ${socket.id} - Table ${tableData.number}`);
    console.log(`👥 Total customers: ${customers.length}`);
  });

  // Xác định loại người dùng
  socket.on('register-role', (data) => {
    // Xử lý trường hợp data là string (backward compatibility)
    if (typeof data === 'string') {
      const role = data;
      if (role === 'employee') employees.push(socket.id);
      if (role === 'customer') customers.push(socket.id);
      if (role === 'kitchen') kitchens.push(socket.id);
      console.log(`📋 ${role} connected: ${socket.id}`);
      return;
    }

    // Xử lý trường hợp data là object
    const { role, userId, branchId } = data;

    console.log(`📥 Register role received:`, { role, userId, branchId });

    if (role === 'employee') {
      employees.push(socket.id);
    }

    if (role === 'customer') {
      customers.push(socket.id);
    }

    if (role === 'kitchen') {
      kitchens.push(socket.id);
      console.log(`👨‍🍳 Kitchen connected: ${socket.id}`);
    }

    if (role === 'admin') {
      admins.push({ socketId: socket.id, userId });
      console.log(`👨‍💼 Admin connected: ${socket.id}, UserID: ${userId}`);
    }

    if (role === 'manager') {
      managers.push({ socketId: socket.id, userId, branchId });
      console.log(`👨‍💼 Manager connected: ${socket.id}, UserID: ${userId}, Branch: ${branchId}`);
    }

    console.log(`📋 ${role} connected: ${socket.id}`);
    console.log(`👥 Total - Admins: ${admins.length}, Managers: ${managers.length}, Employees: ${employees.length}, Kitchens: ${kitchens.length}, Customers: ${customers.length}`);
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
    console.log('Admin approved request:', approvalData);

    // Tìm manager của chi nhánh đó
    const affectedManagers = managers.filter(m =>
      m.branchId === approvalData.branchId
    );

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
    console.log('Admin rejected request:', rejectionData);

    // Tìm manager của chi nhánh đó
    const affectedManagers = managers.filter(m =>
      m.branchId === rejectionData.branchId
    );

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

    const affectedManagers = managers.filter(m =>
      m.branchId === data.branchId
    );

    affectedManagers.forEach((manager) => {
      io.to(manager.socketId).emit('inventory-stock-changed', data);
    });

    admins.forEach((admin) => {
      io.to(admin.socketId).emit('inventory-stock-changed', data);
    });
  });

  // Khi khách hàng hoặc nhân viên đặt đơn hàng
  socket.on("place-order", (orderData) => {
    console.log("🧾 Đơn hàng mới:", orderData);
    console.log("🧾 Order ID:", orderData.id);
    console.log("🧾 Items:", orderData.items);
    console.log("🧾 Total:", orderData.totalAmount);

    // Chuẩn hóa dữ liệu đơn hàng
    const enrichedOrder = {
      ...orderData,
      customerName:
        orderData.customerName ||
        orderData.customer?.name ||
        orderData.customer ||
        `Khách bàn ${orderData.table?.number || orderData.table || "?"}`,
      table:
        typeof orderData.table === "object"
          ? orderData.table
          : { number: orderData.table || "?" },
      // Đảm bảo có items hoặc orderItems
      orderItems: orderData.items || orderData.orderItems || [],
      items: orderData.items || orderData.orderItems || [],
    };

    console.log("📦 Gửi tới", employees.length, "nhân viên");
    console.log("🍳 Gửi tới", kitchens.length, "bếp");

    // Gửi đơn hàng này cho tất cả nhân viên (kể cả người tạo)
    employees.forEach((empId) => {
      io.to(empId).emit("order-for-staff", enrichedOrder);
    });
    // Gửi đơn hàng này cho tất cả bếp
    kitchens.forEach((kitchenId) => {
      io.to(kitchenId).emit("new-order", {
        ...orderData,
        timestamp: new Date().toISOString()
      });
    });

    // Cập nhật bàn cho toàn hệ thống
    io.emit("update-tables");
  });

  // Nhận update order từ backend
  socket.on("order-updated", (orderData) => {
    console.log("🔄 Order updated:", orderData);

    // Broadcast cho tất cả nhân viên
    employees.forEach((empId) => {
      io.to(empId).emit("update-order-status", orderData);
    });
    // Broadcast cho tất cả bếp
    kitchens.forEach((kitchenId) => {
      io.to(kitchenId).emit("update-order-status", orderData);
    });
    io.emit("update-tables");
  });

  // Nhân viên cập nhật trạng thái đơn hàng
  socket.on("order-status-changed", (data) => {
    console.log("🔔 Order status changed:", data);
    console.log(`📦 Order #${data.orderId} - Table ${data.tableNumber} → ${data.newStatus}`);

    // TÌM KHÁCH HÀNG ĐANG NGỒI Ở BÀN ĐÓ
    const affectedCustomers = customers.filter(c => c.tableNumber === data.tableNumber);

    console.log(`👥 Found ${affectedCustomers.length} customer(s) at table ${data.tableNumber}`);

    // GỬI THÔNG BÁO CHO KHÁCH HÀNG
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

    // VẪN GỬI CHO NHÂN VIÊN & BẾP ĐỂ ĐỒNG BỘ
    employees.forEach((empId) => {
      io.to(empId).emit("update-order-status", data);
    });

    kitchens.forEach((kitchenId) => {
      io.to(kitchenId).emit("update-order-status", data);
    });

    io.emit("update-tables");
  });

  // Update order (từ backend)
  socket.on("order-updated", (orderData) => {
    console.log("🔄 Order updated:", orderData);

    employees.forEach((empId) => {
      io.to(empId).emit("update-order-status", orderData);
    });

    kitchens.forEach((kitchenId) => {
      io.to(kitchenId).emit("update-order-status", orderData);
    });

    io.emit("update-tables");
  });

  // Khi bếp cập nhật trạng thái món
  socket.on("update-order-item-status", (itemData) => {
    console.log("👨‍🍳 Bếp cập nhật món:", itemData);

    // Gửi cho tất cả nhân viên phục vụ
    employees.forEach((empId) => {
      io.to(empId).emit("order-item-updated", itemData);
    });

    // Gửi cho các bếp khác để đồng bộ
    kitchens.forEach((kitchenId) => {
      if (kitchenId !== socket.id) { // Không gửi lại cho chính nó
        io.to(kitchenId).emit("order-item-updated", itemData);
      }
    });
  });

  // Khi có sự kiện update-tables
  socket.on("update-tables", () => {
    console.log("📣 Có sự kiện update-tables từ:", socket.id);
    io.emit("update-tables");
  });

  // Khi ngắt kết nối
  socket.on('disconnect', () => {
    const wasEmployee = employees.includes(socket.id);
    const wasCustomer = customers.some(c => c.socketId === socket.id);
    const wasKitchen = kitchens.includes(socket.id);
    const wasAdmin = admins.some(a => a.socketId === socket.id);
    const wasManager = managers.some(m => m.socketId === socket.id);

    employees = employees.filter((id) => id !== socket.id);
    customers = customers.filter((c) => c.socketId !== socket.id);
    kitchens = kitchens.filter((id) => id !== socket.id);
    admins = admins.filter((a) => a.socketId !== socket.id);
    managers = managers.filter((m) => m.socketId !== socket.id);

    console.log('Client disconnected:', socket.id);
    if (wasAdmin) console.log('  - Was an Admin');
    if (wasManager) console.log('  - Was a Manager');
    if (wasEmployee) console.log('  - Was an Employee');
    if (wasKitchen) console.log('  - Was Kitchen');
    if (wasCustomer) console.log('  - Was a Customer');

    console.log(`👥 Remaining - Admins: ${admins.length}, Managers: ${managers.length}, Employees: ${employees.length}, Kitchens: ${kitchens.length}, Customers: ${customers.length}`);
  });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Socket.IO server đang chạy tại http://localhost:${PORT}`);
});