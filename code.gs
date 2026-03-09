// --- CONFIGURATION ---
var DB_NAME = 'Mache_Kretyen_DB';
var FOLDER_NAME = 'Mache_Kretyen_Images';
var TABLE_PRODUCTS = 'products';
var TABLE_MESSAGES = 'messages';
var TABLE_ORDERS = 'orders';
var TABLE_USERS = 'users'; 
/* --- CONFIGURATION RÉGIE PRO --- */
var TABLE_BANNERS_PRO = 'banners_pro';
var BANNER_PRO_SCHEMA = [
  'id', 'title', 'description', 'image_url', 'image_mobile', 'btn_text', 
  'action_type', 'action_value', 'position', 'priority', 'start_date', 
  'end_date', 'status', 'views', 'clicks', 'created_at'
];
// SCHEMA V37 - Elite Marketplace
var PRODUCT_SCHEMA = [
  'id', 'title', 'price', 'vendor', 'vendor_phone', 'vendor_id', 
  'images', 'description', 'category', 'created_at', 'rating', 
  'reviews', 'old_price', 'stock', 'condition', 'shipping_fee', 'sku'
];
var ORDER_SCHEMA = ['id', 'buyer_id', 'vendor_id', 'items_json', 'total_price', 'status', 'buyer_phone', 'date'];
var MESSAGE_SCHEMA = ['id', 'product_id', 'sender_id', 'sender_name', 'receiver_id', 'message', 'timestamp'];
var USER_SCHEMA = ['id', 'phone', 'pin', 'name', 'created_at', 'role', 'avatar', 'bio', 'rating', 'reviews_count'];

function doGet(e) {
  // 1. Récupération sécurisée de tous les paramètres de l'URL
  var params = e && e.parameter ? e.parameter : {};
  
  // 2. Détection de la page demandée via le paramètre URL (?page=...)
  // Si le paramètre 'page' vaut 'RecorderPopup', on charge ce fichier, sinon on charge 'Index'
  var pageToLoad = (params.page === 'RecorderPopup') ? 'RecorderPopup' : 'Index';
  
  var template = HtmlService.createTemplateFromFile(pageToLoad);
  
  // 3. Injection de l'URL de déploiement actuelle (Dynamic Script URL)
  // ScriptApp.getService().getUrl() récupère l'adresse exacte du script publié
  template.scriptUrl = ScriptApp.getService().getUrl();

  // 4. Injection directe dans le HTML (Routage instantané)
  template.initialParams = JSON.stringify(params);

  // 5. Construction de la vue
  return template.evaluate()
      .setTitle('Mache Kretyen')
      .setSandboxMode(HtmlService.SandboxMode.IFRAME)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover'); 
}
function getProductData() {
  // SCHEMA: id(0), title(1), price(2)... stock(13), condition(14), sku(16)
  try {
    var sheet = getOrInitTable('products', ['id']);
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return [];
    data.shift();
    return data.map(function(r){
      return {
        id: r[0], title: r[1], price: r[2], vendor: r[3], images: r[6], 
        category: r[8], stock: Number(r[13])||0, sku: r[16], status: (r[13]>0?'active':'draft')
      };
    });
  } catch(e) { return []; }
}
function processUploads(files) {
  var folder = getOrCreateFolder();
  var urls = [];
  files.forEach(function(f) {
    var split = f.data.split(',');
    var type = split[0].split(';')[0].replace('data:', '');
    var blob = Utilities.newBlob(Utilities.base64Decode(split[1]), type, f.name);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    urls.push("https://lh3.googleusercontent.com/d/" + file.getId());
  });
  return urls.join(',');
}

function getOrCreateFolder() {
  var folders = DriveApp.getFoldersByName(FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(FOLDER_NAME);
}

function deleteProduct(pid, uid) {
  var sheet = getOrInitTable(TABLE_PRODUCTS, PRODUCT_SCHEMA);
  var data = sheet.getDataRange().getValues();
  for(var i=1; i<data.length; i++) {
    if(data[i][0] == pid && data[i][5] == uid) {
      sheet.deleteRow(i+1); return "Supprimé";
    }
  }
  throw new Error("Impossible de supprimer");
}

// --- AUTH & USER ---
function registerUser(phone, pin, name) {
  try {
    var sheet = getOrInitTable(TABLE_USERS, USER_SCHEMA);
    var data = sheet.getDataRange().getValues();
    for(var i=1; i<data.length; i++) { if(String(data[i][1]) === String(phone)) throw new Error("Déjà inscrit"); }
    var newId = "u_" + Math.floor(Math.random()*1000000);
    sheet.appendRow([newId, "'"+phone, "'"+pin, name, new Date()]);
    return { id: newId, name: name, phone: phone };
  } catch(e) { throw new Error(e.message); }
}

// MODIFICATION DU SCHEMA UTILISATEUR (Ajout de la colonne 'role')
// id, phone, pin, name, created_at, role
var USER_SCHEMA = ['id', 'phone', 'pin', 'name', 'created_at', 'role']; 

function loginUser(phone, pin) {
  try {
    var sheet = getOrInitTable(TABLE_USERS, USER_SCHEMA);
    var data = sheet.getDataRange().getValues();

    // Backdoor admin
    if(phone === "0000" && pin === "9999") {
      return { id: "ADMIN_MASTER", name: "Super Admin", phone: "0000", role: "SUPER_ADMIN",
               ordersCount: 0, productsCount: 0, revenue: 0, rating: 5, reviewsCount: 0, avatar: "" };
    }

    for(var i = 1; i < data.length; i++) {
      if(String(data[i][1]) == String(phone) && String(data[i][2]) == String(pin)) {
        var userRole = data[i][5] ? String(data[i][5]).toUpperCase() : 'CLIENT';
        var userId   = data[i][0];
        var userName = data[i][3];

        // --- Calcul ordersCount (achats de cet utilisateur) ---
        var ordersCount = 0;
        try {
          var orders = getAllOrders();
          for(var o = 0; o < orders.length; o++) {
            if(String(orders[o].buyer_id) === String(userId)) ordersCount++;
          }
        } catch(e2) {}

        // --- Calcul productsCount + revenue (si vendeur) ---
        var productsCount = 0;
        var revenue = 0;
        try {
          var products = getProductData();
          for(var pr = 0; pr < products.length; pr++) {
            if(String(products[pr].vendor_id) === String(userId)) productsCount++;
          }
          var allOrders = getAllOrders ? getAllOrders() : [];
          for(var or2 = 0; or2 < allOrders.length; or2++) {
            if(String(allOrders[or2].vendor_id) === String(userId)) {
              revenue += (Number(allOrders[or2].total) || 0);
            }
          }
        } catch(e3) {}

        return {
          id:            userId,
          name:          userName,
          phone:         data[i][1],
          role:          userRole,
          avatar:        data[i][6] || "",
          bio:           data[i][7] || "",
          rating:        Number(data[i][8]) || 5,
          reviewsCount:  Number(data[i][9]) || 0,
          ordersCount:   ordersCount,
          productsCount: productsCount,
          revenue:       revenue
        };
      }
    }
    throw new Error("Identifiants incorrects");
  } catch(e) { throw new Error(e.message); }
}
/* --- CONFIGURATION --- */
var DB_NAME = 'Mache_Kretyen_DB';
var TABLE_PRODUCTS = 'products';
var TABLE_ORDERS = 'orders';
var TABLE_USERS = 'users';
var TABLE_MESSAGES = 'messages';
var TABLE_TICKETS = 'tickets'; 

/* --- FONCTION BACKEND CORRIGÉE (SERIALISATION MANUELLE) --- */
function getDashboardSummary(userId) {
  Logger.log("🔥 [SERVEUR] Démarrage getDashboardSummary...");
  
  var response = { success: true, data: {} };

  try {
    // 1. Récupération des listes (Supposant que vos helpers getAllOrders etc sont là)
    var orders = safeFetch(getAllOrders, []);
    var users = safeFetch(getAllUsers, []);
    var products = safeFetch(getProductData, []);

    // 2. Calculs simples
    var revenue = 0;
    var pending = 0;
    if (orders.length > 0) {
      orders.forEach(function(o) {
        revenue += (Number(o.total) || 0);
        if(o.status === "En attente") pending++;
      });
    }

    // 3. Construction des données
    response.data = {
      kpi: {
        sales_total: revenue,
        orders_total: orders.length,
        users_total: users.length,
        orders_pending: pending,
        products_count: products.length
      },
      recent_orders: orders.slice(0, 10),
      low_stock: products.filter(function(p){ return (p.stock||0) < 5 })
    };

  } catch (e) {
    response.success = false;
    response.message = e.toString();
    Logger.log("ERREUR: " + e.toString());
  }

  // --- LA CORRECTION EST ICI ---
  // On transforme tout en TEXTE pour éviter que Google ne renvoie NULL
  // à cause d'une date mal formatée.
  return JSON.stringify(response); 
}

/* ==========================================================================
   2. API MODULES (Conversion JSON OBLIGATOIRE)
   ========================================================================== */

function fetchFullOrders() {
  Logger.log("📦 [SERVEUR] fetchFullOrders demandé...");
  var response = { success: true, list: [] };
  
  try { 
    response.list = getAllOrders(); 
    Logger.log("   -> " + response.list.length + " commandes trouvées.");
  } catch(e) { 
    response.success = false; 
    response.message = e.toString(); 
    Logger.log("❌ Erreur: " + e.toString());
  }
  
  // MAGIE : On convertit en texte pour éviter le bug NULL
  return JSON.stringify(response);
}

function fetchFullProducts() {
  Logger.log("🏷️ [SERVEUR] fetchFullProducts demandé...");
  var response = { success: true, list: [] };
  
  try { 
    response.list = getProductData(); 
    Logger.log("   -> " + response.list.length + " produits trouvés.");
  } catch(e) { 
    response.success = false; 
    response.message = e.toString();
    Logger.log("❌ Erreur: " + e.toString());
  }
  
  return JSON.stringify(response);
}

function fetchFullUsers() {
  Logger.log("👥 [SERVEUR] fetchFullUsers demandé...");
  var response = { success: true, list: [] };
  
  try { 
    response.list = getAllUsers(); 
    Logger.log("   -> " + response.list.length + " utilisateurs trouvés.");
  } catch(e) { 
    response.success = false; 
    response.message = e.toString();
    Logger.log("❌ Erreur: " + e.toString());
  }
  
  return JSON.stringify(response);
}
/* --- 2. HELPERS & ANALYTICS --- */

function getAllTickets() {
  var TICKET_SCHEMA = ['id', 'subject', 'status', 'priority', 'user_id', 'messages', 'date'];
  try {
    var sheet = getOrInitTable(TABLE_TICKETS, TICKET_SCHEMA);
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return [];
    data.shift();
    return data.map(function(r) {
       return {
         id: r[0], subject: r[1], status: r[2], priority: r[3], user: r[4], 
         msgs: JSON.parse(r[5] || '[]'), time: r[6]
       };
    }).reverse();
  } catch(e) { return []; }
}

function generateSystemAlerts(lowStock, pendingOrders) {
  var alerts = [];
  lowStock.forEach(function(p) {
    alerts.push({ id: 'ALT-S-'+p.id, level: 'HIGH', type: 'STOCK', msg: 'Stock faible: ' + p.title, target: 'Inventaire', time: 'Maintenant', status: 'open' });
  });
  if (pendingOrders > 5) {
    alerts.push({ id: 'ALT-O-LOAD', level: 'CRITICAL', type: 'COMMANDES', msg: pendingOrders + ' commandes à traiter !', target: 'Logistique', time: 'Maintenant', status: 'open' });
  }
  return alerts;
}
function calculateSalesLast7Days(orders) {
  var days=[], am=[]; var t=new Date();
  for(var i=6;i>=0;i--){ var d=new Date(); d.setDate(t.getDate()-i); days.push(d.toLocaleDateString().slice(0,5)); am.push(0); }
  return {labels:days, data:am}; // Simplifié pour éviter crash
}
/* --- 2. HELPERS (Récupération Sécurisée) --- */

/* --- HELPERS NÉCESSAIRES --- */
function safeFetch(fn, fallback) {
  try { return fn() || fallback; } 
  catch (e) { Logger.log("Erreur Fetch: " + e); return fallback; }
}
function getAllOrders() {
  // SCHEMA: id(0), buyer(1), vendor(2), items(3), price(4), status(5), phone(6), date(7)
  try {
    var sheet = getOrInitTable('orders', ['id']); // Nom de la table
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return [];
    data.shift(); 
    return data.map(function(r) {
      var d = r[7];
      if (!(d instanceof Date)) d = new Date(); // Protection date
      return {
        id: r[0], buyer_id: r[1], vendor_id: r[2], total: Number(r[4])||0,
        status: r[5], buyer_phone: r[6], date: d.toLocaleDateString(), full_date: d
      };
    }).reverse();
  } catch(e) { return []; }
}

function getAllUsers() {
  var sheet = getOrInitTable(TABLE_USERS, USER_SCHEMA);
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  data.shift();
  return data.map(function(r) {
    return { 
      id: r[0], phone: r[1], name: r[3], created_at: r[4], 
      role: r[5] || 'CLIENT', 
      // Stats simulées pour CRM
      ltv: 0, trust_score: 85, orders_count: 0, last_login: r[4] 
    };
  });
}
function getUserById(uid) {
  // Backdoor pour le premier accès (si base vide)
  if(uid === "ADMIN_MASTER") return { role: "SUPER_ADMIN" };

  var sheet = getOrInitTable(TABLE_USERS, USER_SCHEMA);
  var data = sheet.getDataRange().getValues();
  
  for(var i=1; i<data.length; i++) {
    // ID est en colonne A (index 0)
    if(String(data[i][0]) === String(uid)) {
       return { 
         id: data[i][0], 
         role: data[i][5] || 'CLIENT' // Rôle en colonne F (index 5)
       };
    }
  }
  return null;
}

/* --- 3. CALCULS FINANCIERS --- */

function calculateTotalSales(orders) {
  return orders.reduce(function(acc, o){ return acc + o.total; }, 0);
}

function calculateTodaySales(orders) {
  var today = new Date().toDateString();
  return orders.reduce(function(acc, o) {
    var d = (o.full_date instanceof Date) ? o.full_date.toDateString() : "";
    return (d === today) ? acc + o.total : acc;
  }, 0);
}

/**
 * Enregistre une commande, déduit le stock, calcule la commission
 * et traque l'attribution marketing (Smart Storefront).
 */
function saveOrder(o) {
  var lock = LockService.getScriptLock();
  
  try {
    lock.waitLock(20000); 

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetOrders = ss.getSheetByName('orders');
    var sheetProducts = ss.getSheetByName('products'); 
    
    if (!sheetOrders) throw new Error("La feuille 'orders' est introuvable.");
    if (!sheetProducts) throw new Error("La feuille 'products' est introuvable.");

    // 1. Génération de l'ID unique
    var id = "CMD-" + Math.floor(Math.random() * 900000 + 100000);
    
    // ==========================================
    // 2. MISE À JOUR DES STOCKS DANS "products"
    // ==========================================
    var productValues = sheetProducts.getDataRange().getValues();
    var pHeaders = productValues[0];
    var colId = pHeaders.indexOf("id");
    var colStock = pHeaders.indexOf("stock"); 
    var colStatus = pHeaders.indexOf("status");

    if (colId > -1 && colStock > -1 && o.items_json) {
      var itemsPurchased = JSON.parse(o.items_json);
      itemsPurchased.forEach(function(item) {
        for (var i = 1; i < productValues.length; i++) {
          if (String(productValues[i][colId]) === String(item.id)) {
            var currentStock = Number(productValues[i][colStock]) || 0;
            var qtyToBuy = Number(item.qty) || 1;
            var newStock = Math.max(0, currentStock - qtyToBuy);
            
            sheetProducts.getRange(i + 1, colStock + 1).setValue(newStock);
            
            if (newStock <= 0 && colStatus !== -1) {
              sheetProducts.getRange(i + 1, colStatus + 1).setValue('alert');
            }
            break; 
          }
        }
      });
    }

    // ==========================================
    // 3. CALCUL FINANCIER (Commissions Vendeur)
    // ==========================================
    var totalBrut = Number(o.total || o.total_price) || 0;
    var commissionDue = totalBrut * 0.10; // 10% Mache

    // ==========================================
    // 4. ENREGISTREMENT DANS "orders"
    // ==========================================
    // Ordre des colonnes : A à K
    sheetOrders.appendRow([
      id,                         // A: id
      o.buyer_id || "GUEST",      // B: buyer_id
      o.vendor_id,                // C: vendor_id
      o.items_json,               // D: items_json
      totalBrut,                  // E: total_price
      "En attente",               // F: status
      o.buyer_phone || "",        // G: buyer_phone
      new Date(),                 // H: date
      commissionDue,              // I: commission (Nouveau)
      o.ref_source || 'organic',  // J: Référant affilié (Nouveau)
      o.traffic_src || 'direct'   // K: Réseau Social / Source (Nouveau)
    ]);

    SpreadsheetApp.flush(); 
    return id;
    
  } catch (e) {
    Logger.log("Erreur saveOrder: " + e.toString());
    throw new Error("Échec de la commande : " + e.message);
  } finally {
    lock.releaseLock();
  }
}
function getVendorOrders(vid) {
  var sheet = getOrInitTable(TABLE_ORDERS, ORDER_SCHEMA);
  var data = sheet.getDataRange().getValues(); data.shift();
  return data.filter(function(r){ return r[2] == vid }).map(fmtOrder);
}

function getUserOrders(uid) {
  var sheet = getOrInitTable(TABLE_ORDERS, ORDER_SCHEMA);
  var data = sheet.getDataRange().getValues(); data.shift();
  return data.filter(function(r){ return r[1] == uid }).map(fmtOrder);
}

/**
 * 🛠️ CORRECTION : Renvoie un objet JSON pour le Frontend (Optimistic UI)
 */
function updateOrderStatus(oid, stat) {
  try {
    var sheet = getOrInitTable(TABLE_ORDERS, ORDER_SCHEMA);
    var data = sheet.getDataRange().getValues();
    
    for(var i=1; i<data.length; i++) {
      if(String(data[i][0]) === String(oid)) { 
        sheet.getRange(i+1, 6).setValue(stat); 
        return { success: true, message: "Statut mis à jour avec succès" }; // Format attendu !
      }
    }
    return { success: false, message: "Commande introuvable" };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

function fmtOrder(r) { 
  return { 
    id: r[0], 
    items: r[3], 
    total: r[4], 
    status: r[5], 
    buyer_phone: r[6], 
    date: (r[7] instanceof Date) ? r[7].toLocaleDateString() : r[7] 
  }; 
}

/* --- RÉCUPÉRER LES MESSAGES (INCLUANT LES IMAGES) --- */
function getUserMessages(uid) {
  var sheet = getOrInitTable('messages', ['id', 'product_id', 'sender_id', 'sender_name', 'receiver_id', 'message', 'timestamp', 'flagged', 'image_url']);
  var data = sheet.getDataRange().getValues(); 
  if(data.length < 2) return [];
  data.shift();
  
  return data.filter(function(r){ return r[2]==uid || r[4]==uid }).map(function(r){
    return { 
      id: r[0], 
      product_id: r[1], 
      sender_id: r[2], 
      sender_name: r[3], 
      receiver_id: r[4], 
      message: r[5], 
      timestamp: (r[6] instanceof Date) ? r[6].toLocaleTimeString() : r[6],
      flagged: r[7],      // Colonne H (Sécurité)
      image_url: r[8]     // Colonne I (Image jointe)
    };
  });
}

/* --- SAUVEGARDE SÉCURISÉE DU MESSAGE (INCLUANT TEXTE, SÉCURITÉ ET IMAGES) --- */
function sendMessage(payload) {
  try {
    // On s'assure d'avoir les 9 colonnes officielles
    var schema = ['id', 'product_id', 'sender_id', 'sender_name', 'receiver_id', 'message', 'timestamp', 'flagged', 'image_url'];
    var sheet = getOrInitTable('messages', schema);
    
    var timestamp = payload.time || new Date().toLocaleString('fr-FR');
    var realId = "MSG-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
    
    sheet.appendRow([
      realId,
      payload.product_id,
      payload.sender_id,
      payload.sender_name,
      payload.receiver_id,
      payload.text,
      timestamp,
      payload.flagged ? "TRUE" : "FALSE", // Marqueur de risque
      payload.image_url || ""             // URL de l'image si présente
    ]);
    
    return JSON.stringify({ success: true, realId: realId });
    
  } catch (e) {
    Logger.log("❌ Erreur SendMessage: " + e.toString());
    return JSON.stringify({ success: false, error: e.toString() });
  }
}
function getOrInitTable(name, schema) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if(!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(schema);
    sheet.getRange(1,1,1,schema.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}
// Fonction d'ajout mise à jour pour la précision commerciale
function addProduct(formObj, files) {
  try {
    var imgs = (files && files.length > 0) ? processUploads(files) : "https://via.placeholder.com/350?text=Image+Bientot+Disponible";
    var sheet = getOrInitTable(TABLE_PRODUCTS, PRODUCT_SCHEMA);
    var newId = "P-" + Math.floor(Math.random()*100000);
    
    sheet.appendRow([
      newId, 
      formObj.title.trim(), 
      Number(formObj.price), 
      formObj.vendor, formObj.phone, formObj.vendor_id, 
      imgs, 
      formObj.desc.trim(), 
      formObj.category, 
      new Date(), 5, 0, 
      Number(formObj.old_price) || 0,
      Number(formObj.stock) || 1,
      formObj.condition || "Neuf",
      Number(formObj.shipping_fee) || 0,
      "SKU-" + Math.random().toString(36).substring(7).toUpperCase()
    ]);
    return "Succès";
  } catch (e) { throw new Error(e.message); }
}
/**
 * Nettoyage ultra-robuste des données pour éviter les erreurs de console
 */
function fmtProduct(r) {
  const clean = (s) => String(s || '').replace(/[\r\n]+/g, " ").replace(/'/g, "\\'").trim();
  
  return {
    id: clean(r[0]), 
    title: clean(r[1] || 'Produit sans nom'), 
    price: Number(r[2]) || 0, 
    vendor: clean(r[3]), 
    vendor_phone: clean(r[4]), 
    vendor_id: clean(r[5]), 
    images: (String(r[6]).indexOf('http') !== -1) ? clean(r[6]) : "", // Vérifie si c'est une URL
    description: clean(r[7]), 
    category: clean(r[8] || 'Autre'),
    rating: Number(r[10]) || 5, 
    reviews: Number(r[11]) || 0, 
    old_price: Number(r[12]) || 0,
    stock: Number(r[13]) || 1,
    condition: clean(r[14] || "Neuf")
  };
}
/* --- CHARGEMENT DES BANNIÈRES PRO --- */
function getHeroBannersData() {
  try {
    var sheet = getOrInitTable(TABLE_BANNERS_PRO, BANNER_PRO_SCHEMA);
    var data = sheet.getDataRange().getValues();
    
    if (data.length < 2) return [];
    data.shift(); // Enlever l'en-tête
    
    var banners = data.map(function(r) {
      return {
        id: r[0], 
        title: r[1], 
        description: r[2], 
        image_url: r[3],
        image_mobile: r[4],
        btn_text: r[5], 
        action_type: r[6], 
        action_value: r[7], 
        position: r[8],
        priority: Number(r[9]) || 99,
        // 💡 TOLÉRANCE : Si la case status (index 12) est vide, on la considère 'active'
        status: r[12] ? String(r[12]).toLowerCase().trim() : 'active'
      };
    });
    
    // Filtrer uniquement les "active" et trier par priorité (1 s'affiche en premier)
    return banners
        .filter(function(b) { return b.status === "active"; })
        .sort(function(a, b) { return a.priority - b.priority; });
        
  } catch(e) { 
    Logger.log("Erreur Bannières: " + e.message);
    return []; 
  }
}
/* --- MISE À JOUR : getHomepageData --- */
function getHomepageData() {
  try {
    var sheet = getOrInitTable(TABLE_PRODUCTS, PRODUCT_SCHEMA);
    var data = sheet.getDataRange().getValues();
    data.shift(); 
    
    var products = data.length > 0 ? data.map(fmtProduct) : [];

    // On renvoie TOUT en un seul bloc pour la vitesse !
    return {
      hero_banners: getHeroBannersData(), // <--- ICI
      all: products
    };
  } catch(e) {
    return { hero_banners: [], all: [] };
  }
}
/* --- FONCTION DE MISE À JOUR PRODUIT --- */
function updateProduct(formObj, files) {
  try {
    var sheet = getOrInitTable(TABLE_PRODUCTS, PRODUCT_SCHEMA);
    var data = sheet.getDataRange().getValues();
    var idToUpdate = formObj.edit_id; // L'ID caché

    // 1. Trouver la ligne
    var rowIndex = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(idToUpdate)) {
        rowIndex = i + 1; // +1 car Sheet commence à 1
        break;
      }
    }

    if (rowIndex === -1) throw new Error("Produit introuvable ID: " + idToUpdate);

    // 2. Gestion Image (Garder l'ancienne si pas de nouvelle)
    var currentImg = data[rowIndex-1][6]; // Index 6 = images
    var newImg = (files && files.length > 0) ? processUploads(files) : currentImg;

    // 3. Écriture dans les cellules (Mise à jour)
    // On met à jour colonne par colonne pour être sûr
    // A=1 (ID), B=2 (Title), C=3 (Price)...
    
    sheet.getRange(rowIndex, 2).setValue(formObj.title);       // Titre
    sheet.getRange(rowIndex, 3).setValue(Number(formObj.price)); // Prix
    sheet.getRange(rowIndex, 7).setValue(newImages);           // Images
    sheet.getRange(rowIndex, 8).setValue(formObj.desc);        // Description
    sheet.getRange(rowIndex, 9).setValue(formObj.category);    // Catégorie
    sheet.getRange(rowIndex, 13).setValue(Number(formObj.old_price)||0); // Prix barré
    sheet.getRange(rowIndex, 14).setValue(Number(formObj.stock)||0);     // Stock
    sheet.getRange(rowIndex, 15).setValue(formObj.condition);            // Condition

    return "✅ Produit mis à jour avec succès !";

  } catch (e) {
    throw new Error("Erreur Update: " + e.message);
  }
}
/* --- OUTIL DE RÉPARATION UNIQUE --- */
function FIX_PRODUCT_SHEET() {
  var sheet = getOrInitTable(TABLE_PRODUCTS, PRODUCT_SCHEMA);
  var data = sheet.getDataRange().getValues();
  var fixedData = [];
  
  // On garde l'entête intact
  fixedData.push(data[0]);

  // On traite les données (à partir de la ligne 2)
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var newRow = new Array(PRODUCT_SCHEMA.length).fill(""); // Crée une ligne vide propre

    // --- ANALYSE DE LA LIGNE ---
    // Cas 1 : Ligne propre (ex: Bible Louis Segond)
    if (String(row[5]).includes("http")) { // Si Col F est une URL
       newRow = row; // On garde tel quel
    } 
    // Cas 2 : Ligne décalée (ex: SM-A05)
    else if (String(row[6]).includes("http")) { // Si Col G est une URL (décalage de 1)
       newRow[0] = row[0]; // ID
       newRow[1] = row[1]; // Title
       newRow[2] = row[2]; // Price
       newRow[3] = row[3]; // Vendor
       newRow[4] = row[4]; // Phone (souvent vide ou ID mal placé)
       
       // CORRECTION INTELLIGENTE
       // Si Col E est un nombre (46256973), c'est probablement le téléphone ou ID
       // Si Col F est "user_...", c'est le Vendor ID
       newRow[5] = row[5]; // Vendor ID (ex: user_105705)
       newRow[6] = row[6]; // Image (ex: https://...)
       newRow[7] = row[7]; // Desc
       newRow[8] = row[8]; // Cat
       newRow[9] = row[9]; // Created At
       
       // Le reste des colonnes...
       for(var k=10; k<row.length; k++) {
         if(k < newRow.length) newRow[k] = row[k];
       }
       
       // Correction spécifique ADMIN_MASTER
       if (row[5] === "ADMIN_MASTER") {
           newRow[5] = "ADMIN_MASTER";
           newRow[6] = row[6]; // Image
       }
    }
    // Cas 3 : Autre cas bizarre (si Col H est URL)
    else if (String(row[7]).includes("http")) {
       newRow[0] = row[0]; // ID
       newRow[1] = row[1]; // Title
       newRow[2] = row[2]; // Price
       newRow[3] = row[3]; // Vendor
       newRow[4] = "";     // Phone (perdu)
       newRow[5] = row[4]; // Vendor ID qui s'est retrouvé en E
       newRow[6] = row[7]; // Image en H
       newRow[7] = row[8]; // Desc en I
       newRow[8] = row[9]; // Cat en J
       newRow[9] = new Date(); // Date
       // ...
    }
    // Cas par défaut (si on ne comprend pas la ligne, on essaie de garder)
    else {
       newRow = row;
    }

    fixedData.push(newRow);
  }

  // --- ÉCRITURE ---
  // On efface tout et on réécrit le propre
  sheet.clearContents();
  sheet.getRange(1, 1, fixedData.length, fixedData[0].length).setValues(fixedData);
  
  return "✅ Réparation terminée : " + (fixedData.length - 1) + " produits traités.";
}
/* --- OUTIL DE RÉINITIALISATION (RESET) --- */
function RESET_PRODUCT_SHEET() {
  var sheet = getOrInitTable(TABLE_PRODUCTS, PRODUCT_SCHEMA);
  
  // 1. Tout effacer
  sheet.clear();
  
  // 2. Remettre l'en-tête (Header)
  sheet.appendRow(PRODUCT_SCHEMA);
  sheet.getRange(1, 1, 1, PRODUCT_SCHEMA.length).setFontWeight("bold");
  sheet.setFrozenRows(1);

  // 3. Données de démo (Bien alignées)
  var demoProducts = [
    [
      "P-1001",                   // id
      "iPhone 13 Pro",            // title
      85000,                      // price
      "Apple Store",              // vendor
      "50933334444",              // vendor_phone
      "ADMIN_MASTER",             // vendor_id
      "https://via.placeholder.com/150", // images
      "Téléphone haut de gamme, 256GB, Bleu Alpin.", // description
      "Électronique",             // category
      new Date(),                 // created_at
      5,                          // rating
      12,                         // reviews
      90000,                      // old_price
      10,                         // stock
      "Neuf",                     // condition
      500,                        // shipping_fee
      "SKU-IPH13"                 // sku
    ],
    [
      "P-1002",
      "Samsung Galaxy S22",
      72000,
      "Tech Zone",
      "50933334444",
      "ADMIN_MASTER",
      "https://via.placeholder.com/150",
      "Écran AMOLED, 128GB, Noir Fantôme.",
      "Électronique",
      new Date(),
      4.5,
      8,
      75000,
      5,
      "Neuf",
      500,
      "SKU-SGS22"
    ],
    [
      "P-1003",
      "Bible Segond 1910",
      2500,
      "Librairie La Grâce",
      "50944445555",
      "user_555",
      "https://via.placeholder.com/150",
      "Couverture cuir véritable, tranches dorées.",
      "Livres",
      new Date(),
      5,
      24,
      0,
      50,
      "Neuf",
      150,
      "SKU-BIB01"
    ],
    [
      "P-1004",
      "Casque Sony WH-1000XM4",
      28000,
      "Audio Pro",
      "50933334444",
      "ADMIN_MASTER",
      "https://via.placeholder.com/150",
      "Réduction de bruit active, 30h autonomie.",
      "Électronique",
      new Date(),
      4.8,
      45,
      35000,
      0, // Rupture de stock (pour tester l'alerte)
      "Neuf",
      250,
      "SKU-SONY4"
    ],
    [
      "P-1005",
      "Guitare Acoustique Yamaha",
      18000,
      "Musique & Co",
      "50944445555",
      "user_555",
      "https://via.placeholder.com/150",
      "Idéale pour débutants, bois massif.",
      "Instruments",
      new Date(),
      4.2,
      6,
      0,
      3,
      "Occasion",
      1000,
      "SKU-YAM01"
    ]
  ];

  // 4. Écrire les données
  // getRange(row, column, numRows, numColumns)
  sheet.getRange(2, 1, demoProducts.length, demoProducts[0].length).setValues(demoProducts);

  return "✅ Feuille Produits réinitialisée avec succès !";
}
/* --- RESET ORDERS SHEET (Données Propres) --- */
function RESET_ORDER_SHEET() {
  var sheet = getOrInitTable(TABLE_ORDERS, ORDER_SCHEMA);
  
  // 1. Tout effacer
  sheet.clear();
  
  // 2. Remettre l'en-tête (Header)
  // ORDER_SCHEMA = ['id', 'buyer_id', 'vendor_id', 'items_json', 'total_price', 'status', 'buyer_phone', 'date'];
  sheet.appendRow(ORDER_SCHEMA);
  sheet.getRange(1, 1, 1, ORDER_SCHEMA.length).setFontWeight("bold");
  sheet.setFrozenRows(1);

  // 3. Génération de fausses données (JSON simulé pour items)
  var itemJson1 = JSON.stringify([{id:"P-1001", title:"iPhone 13 Pro", price:85000, qty:1, vendor:"Apple Store"}]);
  var itemJson2 = JSON.stringify([{id:"P-1003", title:"Bible Segond", price:2500, qty:2, vendor:"Librairie La Grâce"}]);
  
  var demoOrders = [
    [
      "CMD-5001",           // id
      "user_105705",        // buyer_id
      "user_99",            // vendor_id
      itemJson1,            // items_json
      85000,                // total_price
      "En attente",         // status
      "50946256973",        // buyer_phone
      new Date()            // date
    ],
    [
      "CMD-5002",
      "u_659604",
      "user_50",
      itemJson2,
      5000,
      "Expédié",
      "50933331111",
      new Date(new Date().getTime() - 24*60*60*1000) // Hier
    ],
    [
      "CMD-5003",
      "ADMIN_MASTER",
      "MULTI",
      itemJson1,
      85000,
      "Livré",
      "0000",
      new Date(new Date().getTime() - 48*60*60*1000) // Avant-hier
    ]
  ];

  // 4. Écrire les données
  sheet.getRange(2, 1, demoOrders.length, demoOrders[0].length).setValues(demoOrders);

  return "✅ Feuille Commandes (orders) réinitialisée avec succès !";
}
/* --- GRAND NETTOYAGE (USERS, TICKETS, MESSAGES) --- */

function RESET_FULL_SYSTEM() {
  Logger.log("🚀 DÉMARRAGE DU GRAND NETTOYAGE...");
  var logs = [];

  try {
    // 1. Reset Users
    Logger.log("1. Nettoyage Users...");
    var resUsers = RESET_USERS_SHEET();
    logs.push(resUsers);
    Logger.log("   -> OK Users.");

    // 2. Reset Tickets
    Logger.log("2. Nettoyage Tickets...");
    var resTickets = RESET_TICKETS_SHEET();
    logs.push(resTickets);
    Logger.log("   -> OK Tickets.");

    // 3. Reset Messages
    Logger.log("3. Nettoyage Messages...");
    var resMsgs = RESET_MESSAGES_SHEET();
    logs.push(resMsgs);
    Logger.log("   -> OK Messages.");

  } catch (e) {
    Logger.log("❌ ERREUR FATALE : " + e.toString());
    return "Erreur : " + e.toString();
  }

  Logger.log("✅ TERMINÉ ! Le système est propre.");
  return logs.join("\n");
}

function RESET_USERS_SHEET() {
  var schema = ['id', 'phone', 'pin', 'name', 'created_at', 'role', 'avatar', 'bio', 'rating', 'reviews_count'];
  var sheet = getOrInitTable(TABLE_USERS, schema);
  
  sheet.clear();
  sheet.appendRow(schema);
  sheet.getRange(1, 1, 1, schema.length).setFontWeight("bold");
  sheet.setFrozenRows(1);

  // Données de test avec les nouvelles colonnes
  var users = [
    ["ADMIN_MASTER", "0000", "9999", "Super Admin", new Date(), "SUPER_ADMIN", "", "Boutique Officielle", 5, 120],
    ["user_99", "50933334444", "1234", "Jean Pierre", new Date(), "SELLER", "", "Vendeur Pro", 4.5, 34],
    ["user_50", "50944445555", "1234", "Marie Ange", new Date(), "CLIENT", "", "", 0, 0],
    ["user_support", "50911112222", "1234", "Sarah Support", new Date(), "SUPPORT", "", "", 0, 0]
  ];

  sheet.getRange(2, 1, users.length, users[0].length).setValues(users);
  return "Users: OK";
}

function RESET_TICKETS_SHEET() {
  var schema = ['id', 'subject', 'status', 'priority', 'user_id', 'messages', 'date'];
  var sheet = getOrInitTable(TABLE_TICKETS, schema);
  
  sheet.clear();
  sheet.appendRow(schema);
  sheet.getRange(1, 1, 1, schema.length).setFontWeight("bold");
  sheet.setFrozenRows(1);

  // Messages JSON simulés
  var msgJson = JSON.stringify([{from:'me', text:'Colis non reçu', time:'10:00'}, {from:'agent', text:'Je vérifie.', time:'10:05'}]);

  var tickets = [
    ["T-1001", "Retard Livraison", "open", "Haute", "user_50", msgJson, new Date()],
    ["T-1002", "Produit cassé", "closed", "Moyenne", "user_99", "[]", new Date()]
  ];

  sheet.getRange(2, 1, tickets.length, tickets[0].length).setValues(tickets);
  return "Tickets: OK";
}

function RESET_MESSAGES_SHEET() {
  var schema = ['id', 'product_id', 'sender_id', 'sender_name', 'receiver_id', 'message', 'timestamp'];
  var sheet = getOrInitTable(TABLE_MESSAGES, schema);
  
  sheet.clear();
  sheet.appendRow(schema);
  sheet.getRange(1, 1, 1, schema.length).setFontWeight("bold");
  sheet.setFrozenRows(1);

  var messages = [
    ["MSG-1", "P-1001", "user_50", "Marie", "user_99", "Bonjour, dispo ?", new Date()],
    ["MSG-2", "P-1001", "user_99", "Jean", "user_50", "Oui tout à fait.", new Date()]
  ];

  sheet.getRange(2, 1, messages.length, messages[0].length).setValues(messages);
  return "Messages: OK";
}
/* --- CRÉATION DE TICKET (Côté Serveur) --- */
function createTicketInDb(ticketObj) {
  try {
    var sheet = getOrInitTable('tickets', ['id', 'subject', 'status', 'priority', 'user_id', 'messages', 'date']);
    
    // On s'assure que les messages sont bien en JSON texte
    var messagesJson = (typeof ticketObj.messages === 'object') ? JSON.stringify(ticketObj.messages) : ticketObj.messages;
    
    // On ajoute la ligne (Ordre des colonnes important !)
    sheet.appendRow([
      ticketObj.id,
      ticketObj.subject,
      ticketObj.status || 'open',
      ticketObj.priority || 'Normale',
      ticketObj.user_id || 'Anonyme',
      messagesJson,
      new Date() // La date serveur fait foi
    ]);
    
    return JSON.stringify({ success: true, message: "Ticket sauvegardé" });
    
  } catch (e) {
    Logger.log("❌ Erreur Create Ticket : " + e.toString());
    return JSON.stringify({ success: false, message: e.toString() });
  }
}
/* --- LECTURE DES TICKETS (API) --- */
function fetchFullTickets() {
  Logger.log("🎫 [SERVEUR] fetchFullTickets demandé...");
  var response = { success: true, list: [] };
  
  try {
    // On lit la feuille 'tickets'
    var sheet = getOrInitTable('tickets', ['id', 'subject', 'status', 'priority', 'user_id', 'messages', 'date']);
    var data = sheet.getDataRange().getValues();
    
    // Si on a des données (plus que l'en-tête)
    if (data.length > 1) {
      data.shift(); // Enlever l'en-tête
      
      response.list = data.map(function(r) {
        // Décodage des messages (JSON stocké en texte dans la colonne 6)
        var msgs = [];
        try { 
          msgs = (r[5] && r[5] !== "") ? JSON.parse(r[5]) : []; 
        } catch(e) { 
          msgs = []; // En cas d'erreur de format
        }

        return {
          id: String(r[0]),
          subject: String(r[1]),
          status: String(r[2]),
          priority: String(r[3]),
          user_id: String(r[4]), // Important pour filtrer par utilisateur
          msgs: msgs,
          date: (r[6] instanceof Date) ? r[6].toLocaleDateString() : r[6]
        };
      }).reverse(); // Les plus récents en premier
    }
    
  } catch(e) {
    response.success = false;
    response.message = e.toString();
    Logger.log("❌ Erreur Lecture Tickets: " + e.toString());
  }
  
  return JSON.stringify(response);
}
/* --- SAUVEGARDER UN MESSAGE DANS UN TICKET EXISTANT --- */
function replyToTicket(ticketId, messageObj) {
  try {
    var sheet = getOrInitTable('tickets', ['id']); // On récupère la feuille
    var data = sheet.getDataRange().getValues();
    
    // On cherche la ligne correspondant au ticket
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(ticketId)) {
        
        // 1. Lire les messages actuels (Colonne F = Index 5)
        var currentMsgs = [];
        try {
          currentMsgs = JSON.parse(data[i][5] || '[]');
        } catch(e) { currentMsgs = []; }
        
        // 2. Ajouter le nouveau
        currentMsgs.push(messageObj);
        
        // 3. Sauvegarder (Colonne F = 6ème colonne)
        sheet.getRange(i + 1, 6).setValue(JSON.stringify(currentMsgs));
        
        // Optionnel : Mettre à jour le statut (ex: réouvrir si fermé)
        // sheet.getRange(i + 1, 3).setValue('open'); 
        
        return JSON.stringify({ success: true });
      }
    }
    return JSON.stringify({ success: false, message: "Ticket introuvable" });
    
  } catch (e) {
    return JSON.stringify({ success: false, message: e.toString() });
  }
}
/* --- OUTIL DE RÉPARATION DE LA FEUILLE MESSAGES --- */
function FIX_MESSAGES_SHEET() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('messages');
  
  if (!sheet) {
    Logger.log("❌ Feuille 'messages' introuvable.");
    return "Erreur : Feuille introuvable.";
  }

  var data = sheet.getDataRange().getValues();
  var deletedCount = 0;

  // On boucle à l'envers (du bas vers le haut) !
  // C'est obligatoire quand on supprime des lignes pour ne pas décaler les numéros
  for (var i = data.length - 1; i >= 1; i--) { 
    var productId = String(data[i][1]); // La colonne B (product_id) est à l'index 1

    // Si le système trouve "CMD-" au lieu de "P-" dans la colonne produit
    if (productId.indexOf('CMD-') !== -1) {
      sheet.deleteRow(i + 1); // +1 car la feuille commence à la ligne 1, pas 0
      deletedCount++;
    }
  }

  var resultat = "✅ Nettoyage terminé : " + deletedCount + " messages corrompus ont été supprimés.";
  Logger.log(resultat);
  return resultat;
}
/* --- OUTIL DE RÉPARATION DES EN-TÊTES DE LA FEUILLE MESSAGES --- */
function REPAIR_MESSAGES_SHEET() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('messages');
  
  if (!sheet) {
    return "❌ Erreur : Feuille 'messages' introuvable.";
  }

  // Les 9 colonnes officielles (incluant les images et la sécurité)
  var correctHeaders = [
    'id', 'product_id', 'sender_id', 'sender_name', 'receiver_id', 
    'message', 'timestamp', 'flagged', 'image_url'
  ];
  
  // Remplacement de la première ligne
  sheet.getRange(1, 1, 1, correctHeaders.length).setValues([correctHeaders]);
  sheet.getRange(1, 1, 1, correctHeaders.length).setFontWeight("bold");
  
  Logger.log("✅ Feuille messages réparée ! Colonnes 'flagged' et 'image_url' ajoutées.");
  return "Succès";
}
/* --- MOTEUR IA : SUIVI DES INTÉRÊTS --- */
const TABLE_INTERESTS = 'user_interests';
const INTEREST_SCHEMA = ['user_id', 'category', 'score', 'last_action'];

function storeUserEvent(userId, category, weight) {
  if (!userId || !category) return;
  var sheet = getOrInitTable(TABLE_INTERESTS, INTEREST_SCHEMA);
  var data = sheet.getDataRange().getValues();
  var found = false;

  for (var i = 1; i < data.length; i++) {
    if (data[i][0] == userId && data[i][1] == category) {
      // Mise à jour du score existant
      var currentScore = Number(data[i][2]) || 0;
      sheet.getRange(i + 1, 3).setValue(currentScore + weight);
      sheet.getRange(i + 1, 4).setValue(new Date());
      found = true;
      break;
    }
  }

  if (!found) {
    // Création d'un nouvel intérêt
    sheet.appendRow([userId, category, weight, new Date()]);
  }
}
function getUserTasteProfile(userId) {
  var sheet = getOrInitTable(TABLE_INTERESTS, INTEREST_SCHEMA);
  var data = sheet.getDataRange().getValues();
  var profile = {};
  
  data.shift(); // Remove headers
  data.forEach(r => {
    if (r[0] == userId) profile[r[1]] = Number(r[2]);
  });
  
  return profile; // Retourne { 'Electronique': 85, 'Mode': 30 }
}
function applyInterestDecay() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABLE_INTERESTS);
  var data = sheet.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    var score = Number(data[i][2]);
    // Diminue le score de 10% chaque semaine
    sheet.getRange(i + 1, 3).setValue(score * 0.9);
  }
}
/* --- SAUVEGARDER UNE NOUVELLE BANNIÈRE (BACKEND) --- */
function addNewHeroBanner(b) {
  try {
    // S'assure que la table existe
    var sheet = getOrInitTable('hero_banners', ['id', 'title', 'description', 'image_url', 'button_text', 'action', 'active', 'order']);
    
    var newId = "H-" + Math.floor(Math.random() * 100000);
    
    // Ajoute la nouvelle bannière en position 1
    sheet.appendRow([
        newId,
        b.title,
        b.desc,
        b.image,
        b.btnText,
        b.action,
        true,
        1 
    ]);
    
    return "Succès";
  } catch(e) {
    throw new Error(e.message);
  }
}
/* --- SAUVEGARDE BANNIÈRE AVANCÉE --- */
function saveBannerPro(data, files) {
  try {
    var sheet = getOrInitTable(TABLE_BANNERS_PRO, BANNER_PRO_SCHEMA);
    var imgUrl = (files && files.length > 0) ? processUploads(files) : data.image_url;
    
    var newId = "BNR-" + Date.now();
    sheet.appendRow([
      newId,
      data.title,
      data.description,
      imgUrl,
      data.image_mobile || imgUrl, // Fallback mobile
      data.btn_text,
      data.action_type,
      data.action_value,
      data.position || 'hero_slider',
      Number(data.priority) || 0,
      data.start_date || new Date(),
      data.end_date || "",
      "active",
      0, // views
      0, // clicks
      new Date()
    ]);
    return "✅ Campagne publiée avec succès";
  } catch(e) { throw new Error(e.message); }
}

/* --- TRACKING ANALYTICS --- */
function trackBannerClick(id) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABLE_BANNERS_PRO);
  var data = sheet.getDataRange().getValues();
  for(var i=1; i<data.length; i++) {
    if(data[i][0] == id) {
      var currentClicks = Number(data[i][14]) || 0;
      sheet.getRange(i+1, 15).setValue(currentClicks + 1);
      break;
    }
  }
}
/* ==========================================================================
   🧠 ALGORITHME SMART FEED V90 (BACKEND)
   ========================================================================== */
function generateSmartFeed(userId) {
  try {
    // 1. Récupération sécurisée de tous les produits
    var products = [];
    try { products = getProductData(); } catch(e) { products = []; }
    
    // 2. Récupération des bannières promo
    var banners = [];
    try { banners = getHeroBannersData(); } catch(e) { banners = []; }
    
    // 3. Récupérer le profil d'intérêt de l'utilisateur (IA basique)
    var userProfile = {};
    if (userId && userId !== "GUEST") {
        try { userProfile = getUserTasteProfile(userId); } catch(e) {}
    }

    var feed = [];

    // 4. Analyser et noter chaque produit
    products.forEach(function(p) {
        if(p.status === 'draft' || p.stock <= 0) return; // Ignore les indisponibles
        
        var score = 0;
        var reason = "NEW"; // Raison par défaut
        
        // A. Boost Affinité Utilisateur (L'IA)
        if (userProfile[p.category]) {
            score += userProfile[p.category];
            reason = "AFFINITY"; // "Recommandé pour vous"
        }
        
        // B. Boost Promotions (Flash Deal)
        if (p.old_price && p.old_price > p.price) {
            score += 20;
            reason = "TRENDING"; // "Tendance Actuelle"
        }
        
        // C. Randomisation légère pour la découverte (Éviter la bulle de filtre)
        score += Math.random() * 15;
        
        p.feed_score = score;
        p.feed_reason = reason;
        feed.push(p);
    });

    // 5. Trier par score décroissant (Les plus pertinents en haut)
    feed.sort(function(a, b) { return b.feed_score - a.feed_score; });

    // 6. Injecter les Bannières Promotionnelles (Sponsoring) tous les 4 produits
    var finalFeed = [];
    var promoIndex = 0;
    
    for (var i = 0; i < feed.length; i++) {
        finalFeed.push(feed[i]);
        
        // Si c'est le 4ème produit (index 3, 7, 11...) et qu'on a encore des pubs en réserve
        if ((i + 1) % 4 === 0 && banners[promoIndex]) {
            var promo = banners[promoIndex];
            
            // On transforme la bannière en fausse carte produit pour le feed
            finalFeed.push({
                id: promo.id,
                title: promo.title,
                description: promo.description,
                images: promo.image_mobile || promo.image_url,
                price: "OFFRE SPECIALE", // Texte au lieu d'un prix
                vendor: "Mache Ads",
                feed_reason: "PROMO",
                action_type: promo.action_type,
                action_value: promo.action_value
            });
            promoIndex++;
        }
    }

    // 7. On ne renvoie que les 15 premiers pour garantir une fluidité extrême (Mobile)
    return finalFeed.slice(0, 15);

  } catch(e) {
    Logger.log("Erreur critique Smart Feed: " + e.message);
    return []; // Renvoie un tableau vide pour ne pas faire planter le JS
  }
}
function getFeedData() {
  try {
    // Récupérer tous les produits via votre fonction existante
    var products = getProductData(); 
    
    // Filtrer pour ne garder que les produits actifs et limiter aux 10 derniers
    var feedPosts = products
      .filter(function(p) { return p.status !== 'draft' && p.stock > 0; })
      .reverse() // Les plus récents en premier
      .slice(0, 10) 
      .map(function(p) {
        return {
          seller: p.vendor || "Boutique Mache",
          title: p.title,
          description: p.description || "Découvrez ce produit sur Mache Kretyen.",
          image: p.images ? p.images.split(',')[0] : "", // Première image
          avatar: "https://ui-avatars.com/api/?name=" + encodeURIComponent(p.vendor) + "&background=random",
          productId: p.id,
          price: p.price,
          time: "Nouveau" // Vous pourrez calculer le temps réel plus tard
        };
      });
      
    return feedPosts;
  } catch(e) {
    Logger.log("Erreur feed : " + e.message);
    return [];
  }
}
/* ==========================================================================
   🧠 ALGORITHME SMART FEED ENGINE (BACKEND)
   ========================================================================== */
function getSmartFeedData(userId, offset, limit) {
  try {
    offset = offset || 0;
    limit = limit || 10;
    
    // Récupération globale
    var products = safeFetch(getProductData, []);
    var userProfile = {};
    if (userId && userId !== "GUEST") {
        userProfile = safeFetch(function(){ return getUserTasteProfile(userId); }, {});
    }

    var unifiedFeed = [];

    products.forEach(function(p) {
        if(p.status === 'draft' || p.stock <= 0) return; // Filtrer le non-disponible

        // 1. CALCUL DU SCORE MULTICRITÈRES
        var affinityScore = userProfile[p.category] || 0; // Jusqu'à ~100 points
        var popularityScore = Number(p.reviews) || 0; // Simulate popularity
        var randomBoost = Math.random() * 20; // Découverte aléatoire

        var finalScore = (affinityScore * 0.5) + (popularityScore * 0.3) + randomBoost;

        // 2. DÉTERMINATION DU TYPE (Pour les Badges UI)
        var postType = "product";
        if (p.old_price > p.price) postType = "promotion";
        else if (affinityScore > 30) postType = "suggestion";
        else if (popularityScore > 20) postType = "trend";

        // 3. STRUCTURE DE DONNÉES UNIFIÉE (Agnostique)
        unifiedFeed.push({
            id: p.id,
            type: postType,
            score: finalScore,
            created_at: p.created_at || new Date().toISOString(),
            seller: {
                id: p.vendor_id,
                name: p.vendor || "Boutique Mache",
                avatar: "" // Frontend gère le fallback
            },
            content: {
                title: p.title,
                description: p.description || p.category,
                image: p.images ? p.images.split(',')[0] : "",
                price: p.price,
                category: p.category
            },
            stats: {
                views: Math.floor(Math.random() * 200), // Simulé
                likes: Math.floor(Math.random() * 45),  // Simulé
                messages: 0
            },
            raw: p // Gardé pour rétrocompatibilité
        });
    });

    // 4. TRI INTELLIGENT (Les plus hauts scores d'abord)
    unifiedFeed.sort(function(a, b) { return b.score - a.score; });

    // 5. PAGINATION (Infinite Scroll)
    return JSON.stringify(unifiedFeed.slice(offset, offset + limit));

  } catch(e) {
    Logger.log("Erreur Smart Feed Engine: " + e.message);
    return JSON.stringify([]); 
  }
}
/**
 * Marque tous les messages d'une discussion spécifique comme "lus"
 * @param {string} myId - ID de l'utilisateur qui ouvre la discussion (le destinataire)
 * @param {string} partnerId - ID de la personne qui a envoyé les messages
 * @param {string} productId - ID du produit ou de la commande liée
 */
function markMessagesAsRead(myId, partnerId, productId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Messages"); // Assurez-vous que le nom est exact
    if (!sheet) return { success: false, message: "Feuille Messages introuvable" };

    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    // 1. Trouver les index des colonnes critiques
    const idxPid = headers.indexOf("product_id");
    const idxSender = headers.indexOf("sender_id");
    const idxReceiver = headers.indexOf("receiver_id");
    const idxRead = headers.indexOf("read_status"); // ou "read" selon votre colonne

    if (idxPid === -1 || idxSender === -1 || idxReceiver === -1 || idxRead === -1) {
      return { success: false, message: "Colonnes manquantes dans la feuille" };
    }

    let count = 0;
    const updates = [];

    // 2. Parcourir les lignes (en sautant l'en-tête)
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      
      // CONDITION : 
      // - C'est le bon produit
      // - J'en suis le destinataire (receiver_id == myId)
      // - Le partenaire en est l'expéditeur (sender_id == partnerId)
      // - Le statut n'est pas encore "read"
      if (String(row[idxPid]) === String(productId) &&
          String(row[idxReceiver]) === String(myId) &&
          String(row[idxSender]) === String(partnerId) &&
          row[idxRead] !== "read") {
        
        // On prépare la mise à jour pour la cellule correspondante (i + 1 car index 0 et header)
        sheet.getRange(i + 1, idxRead + 1).setValue("read");
        count++;
      }
    }

    console.log(`✅ [DB] ${count} messages marqués comme lus pour le produit ${productId}`);
    return { success: true, count: count };

  } catch (e) {
    console.error("❌ Erreur markMessagesAsRead:", e.message);
    return { success: false, error: e.message };
  }
}
/**
 * Met à jour le timestamp de dernière activité de l'utilisateur
 */
function updateUserPresence(userId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Users");
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idxId = headers.indexOf("id");
    const idxActive = headers.indexOf("last_active");

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idxId]) === String(userId)) {
        sheet.getRange(i + 1, idxActive + 1).setValue(new Date());
        return { success: true };
      }
    }
  } catch (e) { return { success: false, error: e.message }; }
}

/**
 * Récupère le statut de présence d'un partenaire
 */
function getPartnerPresence(partnerId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Users");
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idxId = headers.indexOf("id");
    const idxActive = headers.indexOf("last_active");

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idxId]) === String(partnerId)) {
        const lastActive = data[i][idxActive];
        if (!lastActive) return "Hors ligne";
        
        const now = new Date();
        const diff = (now - new Date(lastActive)) / 1000 / 60; // Différence en minutes
        
        // Si l'activité date de moins de 2 minutes, il est "En ligne"
        if (diff <= 2) return "En ligne";
        
        // Sinon, on affiche "Vu à..."
        return "Vu à " + Utilities.formatDate(new Date(lastActive), "GMT-5", "HH:mm");
      }
    }
    return "Hors ligne";
  } catch (e) { return "Statut inconnu"; }
}
/* ==========================================================================
   🚀 V140: MOTEUR MACHE ADS (BACKEND)
   ========================================================================== */

var TABLE_ADS = 'sponsored_products';
var AD_SCHEMA = [
    'id', 'product_id', 'seller_id', 'campaign_name', 'daily_budget', 
    'total_budget', 'bid_amount', 'start_date', 'end_date', 'target_categories', 
    'target_keywords', 'impressions', 'clicks', 'conversions', 'status', 'created_at'
];

/**
 * Utilitaire pour initialiser la table des publicités si elle n'existe pas
 */
function initAdsTable() {
    getOrInitTable(TABLE_ADS, AD_SCHEMA);
}

function createAdCampaign(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var walletSheet = getOrInitTable('seller_wallet', ['seller_id', 'balance']);
  var adsSheet = getOrInitTable('sponsored_products', AD_SCHEMA);
  
  // 1. Vérification du solde (Côté serveur - Sécurité)
  var walletData = walletSheet.getDataRange().getValues();
  var balance = 0;
  var walletRow = -1;
  
  for(var i=1; i<walletData.length; i++) {
    if(walletData[i][0] == payload.seller_id) {
      balance = walletData[i][1];
      walletRow = i + 1;
      break;
    }
  }
  
  if(balance < payload.total_budget) throw new Error("Solde insuffisant (Rechargez votre Wallet)");

  // 2. Déduction immédiate du budget (Paiement plateforme)
  walletSheet.getRange(walletRow, 2).setValue(balance - payload.total_budget);
  
  // 3. Enregistrement de la campagne
  var adId = "AD-" + Date.now();
  adsSheet.appendRow([
    adId, payload.product_id, payload.seller_id, payload.campaign_name,
    payload.total_budget, payload.total_budget, // Budget initial et restant
    payload.bid_amount, new Date(), '', payload.target_categories, 
    payload.target_keywords, 0, 0, 0, 'ACTIVE', new Date()
  ]);
  
  return "Campagne lancée !";
}
/**
 * Récupère les publicités actives pour le moteur de recommandation
 */
function getActiveAds() {
    try {
        var sheet = getOrInitTable(TABLE_ADS, AD_SCHEMA);
        var data = sheet.getDataRange().getValues();
        if (data.length < 2) return [];
        data.shift(); // Enlever les en-têtes
        
        var activeAds = [];
        var now = new Date();

        for (var i = 0; i < data.length; i++) {
            var row = data[i];
            var status = row[14];
            var endDate = row[8] ? new Date(row[8]) : null;
            var totalBudget = Number(row[5]);
            var cost = Number(row[12]) * Number(row[6]); // clics * enchère (bid)

            // Retourne uniquement les pubs actives avec du budget restant
            if (status === 'ACTIVE' && cost < totalBudget) {
                if (!endDate || endDate >= now) {
                    activeAds.push({
                        ad_id: row[0],
                        product_id: row[1],
                        bid_amount: Number(row[6]),
                        target_categories: row[9].toString().toLowerCase(),
                        target_keywords: row[10].toString().toLowerCase(),
                        row_index: i + 2 // Pour mettre à jour les stats plus tard
                    });
                }
            }
        }
        return activeAds;
    } catch(e) {
        Logger.log("Erreur getActiveAds: " + e);
        return [];
    }
}

/**
 * Gère le clic sur une publicité (Déduit l'argent & Met à jour les stats)
 */
function recordAdClick(adId) {
    try {
        var sheet = getOrInitTable(TABLE_ADS, AD_SCHEMA);
        var data = sheet.getDataRange().getValues();
        
        for (var i = 1; i < data.length; i++) {
            if (data[i][0] === adId) {
                var currentClicks = Number(data[i][12]) || 0;
                sheet.getRange(i + 1, 13).setValue(currentClicks + 1);
                
                // TODO: Déduire le montant de l'enchère (data[i][6]) du portefeuille du vendeur ici
                
                return true;
            }
        }
    } catch(e) {
        Logger.log("Erreur recordAdClick: " + e);
    }
}
/* ==========================================================================
   🚀 MOTEUR DE BOOST - BACKEND (AVEC PREUVE IMAGE)
   ========================================================================== */

// NOUVEAU SCHÉMA (Ajout de 'proof_image' à la fin)
var TABLE_BOOSTS = 'product_boosts';
var BOOST_SCHEMA = ['boost_id', 'product_id', 'seller_id', 'plan_days', 'price_htg', 'status', 'request_date', 'start_date', 'end_date', 'proof_image'];

function createBoostRequest(payload) {
  try {
    var sheet = getOrInitTable(TABLE_BOOSTS, BOOST_SCHEMA);
    var newId = "BST-" + Date.now();
    var now = new Date().toISOString();
    
    sheet.appendRow([
      newId,
      payload.product_id,
      payload.seller_id,
      Number(payload.plan_days),
      Number(payload.price_htg),
      "PENDING",
      now,
      "", 
      "",  
      payload.proof_image || "" // <-- L'image est stockée ici en Base64
    ]);
    
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, message: e.message });
  }
}

// Mise à jour de la fonction Admin pour récupérer la preuve
function getPendingBoosts() {
  try {
    var sheet = getOrInitTable(TABLE_BOOSTS, BOOST_SCHEMA);
    var data = sheet.getDataRange().getValues();
    if(data.length < 2) return [];
    data.shift(); // Enlever les headers
    
    return data.filter(r => r[5] === 'PENDING').map(r => ({
      boost_id: r[0], 
      product_id: r[1], 
      seller_id: r[2], 
      plan_days: r[3], 
      price: r[4], 
      date: r[6],
      proof_image: r[9] // Récupération de l'image
    })).reverse();
  } catch(e) { return []; }
}
/**
 * 3. L'Admin valide le paiement et active le boost
 */
function approveBoost(boostId) {
  try {
    var sheet = getOrInitTable(TABLE_BOOSTS, BOOST_SCHEMA);
    var data = sheet.getDataRange().getValues();
    
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === boostId) {
        var durationDays = Number(data[i][3]);
        var now = new Date();
        var endDate = new Date(now.getTime() + (durationDays * 24 * 60 * 60 * 1000));
        
        sheet.getRange(i + 1, 6).setValue("ACTIVE");
        sheet.getRange(i + 1, 8).setValue(now.toISOString());
        sheet.getRange(i + 1, 9).setValue(endDate.toISOString());
        
        return JSON.stringify({ success: true, message: "Boost activé avec succès !" });
      }
    }
    throw new Error("Boost introuvable");
  } catch (e) {
    return JSON.stringify({ success: false, message: e.message });
  }
}

/**
 * 4. Moteur de Recherche/Feed : Récupère les IDs des produits boostés actifs
 * Gère l'expiration automatiquement à la volée !
 */
function getActiveBoostedProductIds() {
  try {
    var sheet = getOrInitTable(TABLE_BOOSTS, BOOST_SCHEMA);
    var data = sheet.getDataRange().getValues();
    var activeProductIds = [];
    var now = new Date();
    var rowsToUpdate = []; // Pour désactiver ceux qui ont expiré

    for (var i = 1; i < data.length; i++) {
      if (data[i][5] === 'ACTIVE') {
        var endDate = new Date(data[i][8]);
        
        if (now > endDate) {
          // Expiré ! On le note pour mise à jour
          rowsToUpdate.push(i + 1);
        } else {
          // Toujours valide
          activeProductIds.push(String(data[i][1]));
        }
      }
    }

    // Désactivation automatique des expirés
    rowsToUpdate.forEach(rowIdx => {
      sheet.getRange(rowIdx, 6).setValue("EXPIRED");
    });

    return activeProductIds;
  } catch(e) { return []; }
}
/* ==========================================================================
   ⚙️ PARAMÈTRES DE PAIEMENT ADMIN
   ========================================================================== */

function savePaymentSettings(payload) {
  var props = PropertiesService.getScriptProperties();
  
  if (payload.moncashNum) props.setProperty('moncash_num', payload.moncashNum);
  if (payload.moncashQr) props.setProperty('moncash_qr', payload.moncashQr); // Base64
  
  if (payload.natcashNum) props.setProperty('natcash_num', payload.natcashNum);
  if (payload.natcashQr) props.setProperty('natcash_qr', payload.natcashQr); // Base64
  
  return true;
}

function getPaymentSettings() {
  var props = PropertiesService.getScriptProperties();
  return {
    moncashNum: props.getProperty('moncash_num') || '+509 3X XX XX XX',
    moncashQr: props.getProperty('moncash_qr') || 'https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=Moncash',
    natcashNum: props.getProperty('natcash_num') || '+509 4X XX XX XX',
    natcashQr: props.getProperty('natcash_qr') || 'https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=Natcash'
  };
}
function getActiveBoostsWithPlans() {
  try {
    var sheet = getOrInitTable('product_boosts', BOOST_SCHEMA);
    var data = sheet.getDataRange().getValues();
    if(data.length < 2) return {};
    data.shift(); // Headers
    
    var now = new Date();
    var boostMap = {};
    
    data.forEach(function(r) {
       var status = r[5];
       var endDate = new Date(r[8]);
       if (status === 'ACTIVE' && endDate > now) {
          boostMap[String(r[1])] = r[3]; // r[1] = product_id, r[3] = plan_days
       }
    });
    return boostMap;
  } catch(e) { return {}; }
}
// ==========================================================================
// 📡 BACKEND : RÉCUPÉRATION DU PROFIL VENDEUR
// ==========================================================================
function getSellerProfilePro(sellerId) {
  var defaultProfile = {
    name: "Boutique Officielle", description: "", logo: "", 
    rating: 5, reviews: 0, sales: 0,
    extended: {
      banner: "", theme: "#e47911", location: "",
      whatsapp: "", email: "", show_phone: true, allow_dm: true,
      moncash: "", natcash: "", account_name: "",
      vacation_mode: false, enable_delivery: true, accept_returns: false
    }
  };
  
  try {
    // Insensibilité à la casse pour le nom de la feuille
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var usersSheet = ss.getSheetByName('Users') || ss.getSheetByName('users') || ss.getSheetByName('Utilisateurs');
    
    if (!usersSheet) return defaultProfile;

    var usersData = usersSheet.getDataRange().getValues();
    
    for (var i = 1; i < usersData.length; i++) {
      if (String(usersData[i][0]) === String(sellerId)) {
        var row = usersData[i];
        
        defaultProfile.name = row[3] || "Boutique"; // Ajustez l'index si besoin (ex: Colonne D = 3)
        defaultProfile.logo = row[6] || "";         // Ajustez (ex: Colonne G = 6)
        defaultProfile.description = row[7] || "";  // Ajustez (ex: Colonne H = 7)
        defaultProfile.rating = Number(row[8]) || 5;
        defaultProfile.reviews = Number(row[9]) || 0;
        
        // Données JSON étendues
        if (row.length > 10 && row[10]) {
          try {
            var savedExtended = JSON.parse(row[10]);
            defaultProfile.extended = Object.assign(defaultProfile.extended, savedExtended);
          } catch(e) {}
        }
        break;
      }
    }

    // Calcul des ventes réelles (Confiance)
    var ordersSheet = ss.getSheetByName('Orders') || ss.getSheetByName('orders') || ss.getSheetByName('Commandes');
    if (ordersSheet) {
      var ordersData = ordersSheet.getDataRange().getValues();
      var salesCount = 0;
      for (var j = 1; j < ordersData.length; j++) {
        // En supposant que le Vendeur ID est en colonne C (index 2) et Statut en F (index 5)
        if (String(ordersData[j][2]) === String(sellerId) && ordersData[j][5] === "Livré") {
          salesCount++;
        }
      }
      defaultProfile.sales = salesCount;
    }

    return defaultProfile;
  } catch (e) {
    Logger.log("Erreur getSellerProfilePro: " + e.toString());
    return defaultProfile; 
  }
}
/**
 * SAUVEGARDE PROFESSIONNELLE V160 (FIX DÉFINITIF)
 */
function updateSellerProfilePro(userId, payload) {
  console.log("🚀 [BACKEND] Tentative de sauvegarde pour : " + userId);
  
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('users');
    var rows = sheet.getDataRange().getValues();
    
    // 1. Gestion des images (Conversion Base64 -> URL Drive pour alléger le JSON)
    if (payload.logo && payload.logo.startsWith('data:image')) {
      payload.logo = saveBase64ImageToDrive(payload.logo, "Logo_" + userId);
    }
    if (payload.extended && payload.extended.banner && payload.extended.banner.startsWith('data:image')) {
      payload.extended.banner = saveBase64ImageToDrive(payload.extended.banner, "Banner_" + userId);
    }

    // 2. Recherche de l'utilisateur dans la colonne A
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(userId)) {
        var rowIdx = i + 1;
        
        // Mise à jour des colonnes existantes
        if (payload.name) sheet.getRange(rowIdx, 4).setValue(payload.name); // Nom (Col D)
        if (payload.logo) sheet.getRange(rowIdx, 7).setValue(payload.logo); // Logo URL (Col G)
        if (payload.description !== undefined) sheet.getRange(rowIdx, 8).setValue(payload.description); // Bio (Col H)
        
        // 🎯 SAUVEGARDE DANS LA COLONNE K (11)
        if (payload.extended) {
          var settingsString = JSON.stringify(payload.extended);
          sheet.getRange(rowIdx, 11).setValue(settingsString); 
        }
        
        return { success: true, message: "Enregistré avec succès !" };
      }
    }
    return { success: false, message: "Utilisateur non trouvé dans la liste." };
  } catch (e) {
    return { success: false, message: "Erreur Serveur: " + e.toString() };
  }
}

/**
 * Helper: Sauvegarde une image Base64 sur Drive et retourne son URL publique
 */
function saveBase64ImageToDrive(base64Data, fileName) {
  var folder = getOrCreateFolder(); // Utilise votre fonction existante
  var split = base64Data.split(',');
  var type = split[0].split(';')[0].replace('data:', '');
  var blob = Utilities.newBlob(Utilities.base64Decode(split[1]), type, fileName);
  
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  
  // Retourne l'URL de l'image directe
  return "https://lh3.googleusercontent.com/d/" + file.getId();
}
function updateUserProfile(userId, data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('users');
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(userId)) {
      if (data.name) sheet.getRange(i + 1, 4).setValue(data.name); // Col D
      if (data.bio) sheet.getRange(i + 1, 8).setValue(data.bio);   // Col H
      if (data.avatar) sheet.getRange(i + 1, 7).setValue(data.avatar); // Col G
      return true;
    }
  }
  return false;
}
// ==========================================================================
// 🛠️ OUTILS DE RÉPARATION ET STATISTIQUES (À coller dans Code.gs)
// ==========================================================================

/**
 * Exécutez cette fonction UNE SEULE FOIS depuis l'éditeur pour réparer la base
 */
function FIX_USERS_SHEET() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('users');
  
  if (!sheet) return "Erreur: Feuille 'users' introuvable.";

  // Les 11 colonnes officielles pour le Centre de Contrôle V160
  var headers = ['id', 'phone', 'pin', 'name', 'created_at', 'role', 'avatar', 'bio', 'rating', 'reviews_count', 'settings_json'];
  
  // 1. Mettre à jour l'en-tête (Ligne 1)
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");

  // 2. Nettoyer les données corrompues dans la colonne K (index 11)
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var data = sheet.getRange(2, 11, lastRow - 1, 1).getValues();
    for (var i = 0; i < data.length; i++) {
      var jsonStr = String(data[i][0]).trim();
      // Si la cellule contient du texte mais pas un JSON valide (qui commence par '{')
      if (jsonStr !== "" && !jsonStr.startsWith("{")) {
        data[i][0] = ""; // On efface pour éviter les crashs de lecture
      }
    }
    sheet.getRange(2, 11, lastRow - 1, 1).setValues(data);
  }

  Logger.log("✅ Feuille 'users' réparée ! Colonne 'settings_json' ajoutée en K1.");
  return "Succès";
}


/**
 * Cette fonction manquait et causait l'erreur "runner is not a function"
 */
function getSellerAnalytics(sellerId) {
  var defaultStats = { views: 0, clicks: 0, activeBoosts: 0 };
  try {
    var productsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('products');
    if(!productsSheet) return defaultStats;
    
    var productsData = productsSheet.getDataRange().getValues();
    
    // Si la fonction getActiveBoostedProductIds n'existe pas, on met un tableau vide pour éviter le crash
    var activeBoostedIds = [];
    try { activeBoostedIds = getActiveBoostedProductIds() || []; } catch(e) {}
    
    var activeBoostsCount = 0;

    for (var i = 1; i < productsData.length; i++) {
       if (String(productsData[i][5]) === String(sellerId)) {
          if (activeBoostedIds.indexOf(String(productsData[i][0])) !== -1) {
             activeBoostsCount++;
          }
       }
    }

    return {
      views: Math.floor(Math.random() * 150) + 20, // Simulées pour l'instant
      clicks: Math.floor(Math.random() * 80) + 5,
      activeBoosts: activeBoostsCount
    };
  } catch (e) {
    Logger.log("Erreur Analytics: " + e.toString());
    return defaultStats;
  }
}
// ==========================================================================
// 📦 GESTION DES PRODUITS (VENDEUR) - CREATION, EDITION, SUPPRESSION
// ==========================================================================

function deleteProduct(productId, sellerId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('products');
    var data = sheet.getDataRange().getValues();
    
    // Parcourt les produits pour trouver le bon ID ET vérifier le propriétaire
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(productId) && String(data[i][5]) === String(sellerId)) { 
        sheet.deleteRow(i + 1); // +1 car les tableaux JS commencent à 0, Google Sheets à 1
        return { success: true, message: "Produit retiré de la vente." };
      }
    }
    return { success: false, message: "Produit introuvable ou accès refusé." };
  } catch(e) {
    return { success: false, message: e.toString() };
  }
}

function updateSellerProduct(obj, files) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('products');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  
  var colId = headers.indexOf("id");
  var colStock = headers.indexOf("stock"); // Colonne N (index 13)

  // 1. Trouver la ligne
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][colId]) === String(obj.edit_id)) {
      
      // 2. Mettre à jour les colonnes de base (à adapter selon votre ordre A-Z)
      // Exemple : Titre en B, Prix en C, etc.
      sheet.getRange(i + 1, headers.indexOf("title") + 1).setValue(obj.title);
      sheet.getRange(i + 1, headers.indexOf("price") + 1).setValue(obj.price);
      sheet.getRange(i + 1, headers.indexOf("description") + 1).setValue(obj.desc);
      sheet.getRange(i + 1, colStock + 1).setValue(obj.stock);
      sheet.getRange(i + 1, headers.indexOf("category") + 1).setValue(obj.category);
      
      // 3. Gestion de l'image (uniquement si une nouvelle est fournie)
      if (files && files.length > 0) {
        var imageUrl = saveImageToDrive(files[0]); // Votre fonction d'upload existante
        sheet.getRange(i + 1, headers.indexOf("images") + 1).setValue(imageUrl);
      }
      
      return {success: true};
    }
  }
  throw new Error("Produit non trouvé en base de données.");
}
/**
 * Récupère les statistiques réelles du vendeur pour le dashboard
 */
function getDashboardData(vendorId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('orders'); 
  if (!sheet) return { volumeVentes: 0, aTraiter: 0, commission: 0, chartData: {} };

  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  
  // Localisation des colonnes
  var colVendor = headers.indexOf("vendor_id");
  var colTotal = headers.indexOf("total_price");
  var colStatus = headers.indexOf("status");
  var colDate = headers.indexOf("date");

  var stats = {
    volumeVentes: 0,
    aTraiter: 0,
    commission: 0,
    chartData: {} // Format : {"DD/MM": total, ...}
  };

  for (var i = 1; i < data.length; i++) {
    // Filtrer par vendeur
    if (String(data[i][colVendor]) === String(vendorId)) {
      var total = Number(data[i][colTotal]) || 0;
      var status = data[i][colStatus];
      var dateRaw = data[i][colDate];

      // 1. Volume Brut & Commission (Exclure les annulés)
      if (status !== "Annulé") {
        stats.volumeVentes += total;
        stats.commission += (total * 0.10); // 10% Platform commission
      }

      // 2. Commandes à traiter
      if (status === "En attente" || status === "Expédié") {
        stats.aTraiter++;
      }

      // 3. Données du graphique (7 derniers jours)
      if (dateRaw && status !== "Annulé") {
        var dateLabel = (typeof dateRaw === "string") ? dateRaw.split(' ')[0] : Utilities.formatDate(dateRaw, "GMT-5", "dd/MM");
        stats.chartData[dateLabel] = (stats.chartData[dateLabel] || 0) + total;
      }
    }
  }

  return stats;
}
function uploadVoiceNote(base64, receiverId) {
    const folderId = "ID_DE_VOTRE_DOSSIER_DRIVE"; // Créez un dossier pour les audios
    const folder = DriveApp.getFolderById(folderId);
    
    // Décoder et créer le fichier
    const decoded = Utilities.base64Decode(base64);
    const blob = Utilities.newBlob(decoded, 'audio/webm', 'voice_note_' + new Date().getTime() + '.webm');
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const audioUrl = file.getUrl();

    // Enregistrer dans la feuille Messages (ajustez selon votre schéma)
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("messages");
    sheet.appendRow([
        new Date(),
        getCurrentUserId(), // Expéditeur
        receiverId,        // Destinataire
        "🎤 [Message Vocal]", 
        audioUrl           // Lien Drive vers l'audio
    ]);
    
    return true;
}
// ==========================================================================
// 🚀 SMART TRAFFIC & RANKING ENGINE
// ==========================================================================

/**
 * Enregistre une visite de manière asynchrone (Appelé par le frontend)
 */
function recordStoreVisit(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrInitTable('traffic_logs', ['date', 'seller_id', 'ref', 'src', 'campaign', 'visitor_id']);
  
  sheet.appendRow([
    new Date(),
    payload.seller_id,
    payload.ref,
    payload.src,
    payload.campaign,
    payload.visitor_id
  ]);
  
  // Optionnel: Maintenir un compteur rapide dans le profil vendeur
  return true;
}

/**
 * Moteur de Ranking : Calcule le score de chaque vendeur pour la page d'accueil
 * À appeler par un déclencheur temporel (ex: 1 fois par jour) ou à la volée.
 */
function calculateSellerScores() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var productsSheet = ss.getSheetByName('products');
  var trafficSheet = ss.getSheetByName('traffic_logs');
  var ordersSheet = ss.getSheetByName('orders'); // Requiert colonne 'ref_source'
  
  // 1. Agréger le trafic par vendeur
  var trafficData = trafficSheet.getDataRange().getValues();
  var visitsBySeller = {};
  for(var i=1; i<trafficData.length; i++) {
     var sid = trafficData[i][1];
     visitsBySeller[sid] = (visitsBySeller[sid] || 0) + 1;
  }
  
  // 2. Agréger les conversions (Ventes organiques vs Ventes référées)
  // ... (Logique d'agrégation des commandes) ...
  
  // 3. Calcul du Score pour chaque produit/vendeur
  var pData = productsSheet.getDataRange().getValues();
  var headers = pData[0];
  var colId = headers.indexOf("vendor_id");
  var colScore = headers.indexOf("smart_score"); // Créez cette colonne
  
  if (colScore === -1) return; // Sécurité

  for(var j=1; j<pData.length; j++) {
      var vendorId = pData[j][colId];
      var rating = Number(pData[j][headers.indexOf("rating")]) || 5;
      var sales = Number(pData[j][headers.indexOf("sales")]) || 0;
      var traffic = visitsBySeller[vendorId] || 0;
      
      // 🧠 L'Algorithme Secret : "SellerScore"
      // (0.4 * Rating) + (0.3 * Ventes) + (0.2 * Trafic Généré)
      var score = (rating * 40) + (sales * 3) + (traffic * 2);
      
      productsSheet.getRange(j+1, colScore + 1).setValue(score);
  }
}
/**
 * 🚀 SMART TRAFFIC TRACKER
 * Enregistre chaque visite issue d'un lien partagé (Appelé par le Frontend)
 */
function recordStoreVisit(payload) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('traffic_logs');
    
    // Auto-création de l'onglet s'il n'existe pas !
    if (!sheet) {
      sheet = ss.insertSheet('traffic_logs');
      sheet.appendRow(['date', 'seller_id', 'ref_source', 'traffic_source', 'campaign', 'visitor_id']);
      sheet.setFrozenRows(1); // Fige la ligne des titres
      Logger.log("✅ Onglet 'traffic_logs' créé automatiquement.");
    }

    // Insertion de la visite
    sheet.appendRow([
      new Date(),
      payload.seller_id || 'unknown',
      payload.ref || 'organic',
      payload.src || 'direct',
      payload.campaign || 'none',
      payload.visitor_id || 'anonymous'
    ]);
    
    return { success: true };
    
  } catch(e) {
    Logger.log("❌ Erreur recordStoreVisit : " + e.toString());
    return { success: false, message: e.toString() };
  }
}
/**
 * 👑 MOTEUR DE RANKING (SMART SCORE)
 * Calcule la note de chaque produit basée sur : Avis + Ventes + Trafic généré
 */
function calculateSellerScores() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var trafficSheet = ss.getSheetByName('traffic_logs');
  var productsSheet = ss.getSheetByName('products');
  
  if (!productsSheet || !trafficSheet) {
      Logger.log("⚠️ Feuilles manquantes pour le calcul des scores.");
      return;
  }

  // 1. Compter les visites amenées par chaque vendeur
  var trafficData = trafficSheet.getDataRange().getValues();
  var visitsBySeller = {};
  
  if (trafficData.length > 1) {
    var tHeaders = trafficData[0];
    var tSellerIdx = tHeaders.indexOf('seller_id');
    
    if(tSellerIdx > -1) {
        for (var i = 1; i < trafficData.length; i++) {
          var sid = String(trafficData[i][tSellerIdx]);
          if (sid) visitsBySeller[sid] = (visitsBySeller[sid] || 0) + 1;
        }
    }
  }

  // 2. Mettre à jour le Smart Score des produits
  var pData = productsSheet.getDataRange().getValues();
  var pHeaders = pData[0];
  
  var vendorIdx = pHeaders.indexOf('vendor_id');
  var ratingIdx = pHeaders.indexOf('rating');
  var salesIdx = pHeaders.indexOf('sales');
  var scoreIdx = pHeaders.indexOf('smart_score'); 

  // Auto-création de la colonne smart_score si absente
  if (scoreIdx === -1) {
    scoreIdx = pHeaders.length;
    productsSheet.getRange(1, scoreIdx + 1).setValue('smart_score');
  }

  if (vendorIdx === -1) return; // Impossible de calculer sans vendor_id

  for (var j = 1; j < pData.length; j++) {
    var vId = String(pData[j][vendorIdx]);
    
    var rating = Number(pData[j][ratingIdx]) || 5; 
    var sales = Number(pData[j][salesIdx]) || 0; 
    var traffic = visitsBySeller[vId] || 0; 
    
    // 🧠 LA FORMULE DE CROISSANCE (Modifiable)
    // Ex: (5 étoiles * 8) + (2 ventes * 3) + (15 visites * 1) = 61 pts
    var score = Math.round((rating * 8) + (sales * 3) + (traffic * 1));
    
    // Écriture du nouveau score dans Google Sheets
    productsSheet.getRange(j + 1, scoreIdx + 1).setValue(score);
  }
  
  Logger.log("✅ Smart Scores calculés et mis à jour avec succès !");
}
// ============================================================
// 🔗 MODULE AFFILIÉS & STOREFRONTS PARTAGEABLES - V1
// Mache Kretyen - Google Apps Script
// ============================================================
// TABLE DES MATIÈRES
// 1. CONFIGURATION & SCHÉMAS
// 2. GÉNÉRATION & GESTION DES LIENS D'AFFILIATION
// 3. TRACKING & ATTRIBUTION
// 4. TABLEAU DE BORD AFFILIÉS (VENDEUR)
// 5. STOREFRONT PUBLIC ENRICHI
// 6. UTILITAIRES
// ============================================================


// ── 1. CONFIGURATION & SCHÉMAS ──────────────────────────────

var TABLE_AFFILIATES     = 'affiliates';
var TABLE_AFFILIATE_CLICKS = 'affiliate_clicks';
var TABLE_AFFILIATE_CONVERSIONS = 'affiliate_conversions';

// Schéma: Table affiliates
// id | seller_id | ref_code | type | commission_pct | clicks | conversions | earnings | status | created_at
var AFFILIATE_SCHEMA = [
  'id', 'seller_id', 'ref_code', 'type',
  'commission_pct', 'clicks', 'conversions',
  'earnings', 'status', 'created_at'
];

// Schéma: Table affiliate_clicks
// id | ref_code | seller_id | visitor_id | src | campaign | ip_hash | user_agent | timestamp | converted
var AFFILIATE_CLICKS_SCHEMA = [
  'id', 'ref_code', 'seller_id', 'visitor_id',
  'src', 'campaign', 'ip_hash', 'user_agent',
  'timestamp', 'converted'
];

// Schéma: Table affiliate_conversions
// id | click_id | ref_code | seller_id | buyer_id | order_id | order_total | commission_earned | status | created_at
var AFFILIATE_CONVERSIONS_SCHEMA = [
  'id', 'click_id', 'ref_code', 'seller_id',
  'buyer_id', 'order_id', 'order_total',
  'commission_earned', 'status', 'created_at'
];

// Taux de commission par défaut pour les affiliés externes (non-vendeurs)
var DEFAULT_AFFILIATE_COMMISSION = 0.05; // 5%


// ── 2. GÉNÉRATION & GESTION DES LIENS D'AFFILIATION ─────────

/**
 * Génère ou récupère un code d'affiliation unique pour un vendeur.
 * Chaque vendeur a son propre ref_code pour son storefront.
 * Un affilié externe peut aussi avoir un code pour promouvoir tous les produits.
 *
 * @param {string} userId  - ID de l'utilisateur qui demande le code
 * @param {string} type    - 'seller' (pour son propre store) | 'affiliate' (externe)
 * @returns {Object}       - { success, ref_code, link, stats }
 */
function getOrCreateAffiliateCode(userId, type) {
  try {
    var sheet = getOrInitTable(TABLE_AFFILIATES, AFFILIATE_SCHEMA);
    var data  = sheet.getDataRange().getValues();
    var headers = data[0];

    var colId         = headers.indexOf('id');
    var colSeller     = headers.indexOf('seller_id');
    var colRef        = headers.indexOf('ref_code');
    var colType       = headers.indexOf('type');
    var colClicks     = headers.indexOf('clicks');
    var colConversions= headers.indexOf('conversions');
    var colEarnings   = headers.indexOf('earnings');
    var colStatus     = headers.indexOf('status');

    // Recherche d'un code existant
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][colSeller]) === String(userId) &&
          String(data[i][colType])   === String(type)   &&
          data[i][colStatus] === 'active') {

        var existingCode = data[i][colRef];
        var scriptUrl    = ScriptApp.getService().getUrl();
        return {
          success:     true,
          ref_code:    existingCode,
          link:        scriptUrl + '?v=store&s=' + userId + '&ref=' + existingCode,
          product_link: scriptUrl + '?ref=' + existingCode,
          clicks:      Number(data[i][colClicks])      || 0,
          conversions: Number(data[i][colConversions]) || 0,
          earnings:    Number(data[i][colEarnings])    || 0
        };
      }
    }

    // Création d'un nouveau code
    var newCode  = _generateRefCode(userId);
    var newId    = 'AFF-' + Date.now();
    var commPct  = type === 'seller' ? 0 : DEFAULT_AFFILIATE_COMMISSION;

    sheet.appendRow([
      newId, userId, newCode, type,
      commPct, 0, 0, 0, 'active',
      new Date()
    ]);

    var scriptUrl = ScriptApp.getService().getUrl();
    return {
      success:      true,
      ref_code:     newCode,
      link:         scriptUrl + '?v=store&s=' + userId + '&ref=' + newCode,
      product_link: scriptUrl + '?ref=' + newCode,
      clicks:       0,
      conversions:  0,
      earnings:     0
    };

  } catch(e) {
    Logger.log('❌ getOrCreateAffiliateCode: ' + e.toString());
    return { success: false, message: e.toString() };
  }
}

/**
 * Génère un code ref unique, lisible et court (ex: "MK-A1B2C3")
 * @private
 */
function _generateRefCode(userId) {
  var chars   = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var code    = 'MK-';
  // Seed partiel sur userId pour reproductibilité relative
  var seed    = String(userId).slice(-3).toUpperCase();
  code += seed.replace(/[^A-Z0-9]/g, 'X');
  // 3 chars aléatoires
  for (var i = 0; i < 3; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}


// ── 3. TRACKING & ATTRIBUTION ────────────────────────────────

/**
 * Enregistre un clic sur un lien affilié (appelé par le frontend au chargement).
 * Stocke le ref_code dans PropertiesService pour attribution ultérieure à la commande.
 *
 * @param {Object} payload - { ref_code, visitor_id, src, campaign, user_agent }
 * @returns {Object}       - { success, seller_id, type }
 */
function trackAffiliateClick(payload) {
  try {
    if (!payload || !payload.ref_code) return { success: false };

    var refCode   = String(payload.ref_code).trim().toUpperCase();
    var visitorId = payload.visitor_id || 'anon-' + Date.now();

    // 1. Trouver le code affilié
    var affSheet = getOrInitTable(TABLE_AFFILIATES, AFFILIATE_SCHEMA);
    var affData  = affSheet.getDataRange().getValues();
    var headers  = affData[0];

    var colId     = headers.indexOf('id');
    var colSeller = headers.indexOf('seller_id');
    var colRef    = headers.indexOf('ref_code');
    var colType   = headers.indexOf('type');
    var colClicks = headers.indexOf('clicks');
    var colStatus = headers.indexOf('status');

    var foundRow  = -1;
    var sellerId  = null;
    var affType   = null;

    for (var i = 1; i < affData.length; i++) {
      if (String(affData[i][colRef]).toUpperCase() === refCode &&
          affData[i][colStatus] === 'active') {
        foundRow = i + 1; // Ligne Sheets (1-indexed)
        sellerId = affData[i][colSeller];
        affType  = affData[i][colType];
        break;
      }
    }

    if (foundRow === -1) return { success: false, message: 'Code inconnu' };

    // 2. Incrémenter le compteur de clics
    affSheet.getRange(foundRow, colClicks + 1).setValue(
      (Number(affSheet.getRange(foundRow, colClicks + 1).getValue()) || 0) + 1
    );

    // 3. Log dans affiliate_clicks
    var clickSheet = getOrInitTable(TABLE_AFFILIATE_CLICKS, AFFILIATE_CLICKS_SCHEMA);
    var clickId    = 'CLK-' + Date.now();

    clickSheet.appendRow([
      clickId, refCode, sellerId, visitorId,
      payload.src      || 'direct',
      payload.campaign || 'none',
      _hashIp(payload.ip || ''),
      payload.user_agent || '',
      new Date(), false
    ]);

    // 4. Mise à jour du traffic_logs existant (compatibilité avec l'ancien système)
    try {
      recordStoreVisit({
        seller_id:  sellerId,
        ref:        refCode,
        src:        payload.src || 'affiliate_link',
        campaign:   payload.campaign || 'none',
        visitor_id: visitorId
      });
    } catch(e) { /* Non-bloquant */ }

    return {
      success:   true,
      click_id:  clickId,
      seller_id: sellerId,
      type:      affType
    };

  } catch(e) {
    Logger.log('❌ trackAffiliateClick: ' + e.toString());
    return { success: false, message: e.toString() };
  }
}

/**
 * Enregistre une conversion d'affiliation lors d'une commande.
 * À appeler depuis saveOrder() juste après la création de la commande.
 *
 * @param {string} orderId    - ID de la commande créée
 * @param {string} buyerId    - ID de l'acheteur
 * @param {number} orderTotal - Montant total de la commande
 * @param {string} refCode    - Code ref utilisé (peut être null)
 * @returns {Object}          - { success, commission }
 */
function recordAffiliateConversion(orderId, buyerId, orderTotal, refCode) {
  try {
    if (!refCode) return { success: false, message: 'Pas de ref_code' };

    refCode = String(refCode).trim().toUpperCase();

    // Trouver l'affilié
    var affSheet = getOrInitTable(TABLE_AFFILIATES, AFFILIATE_SCHEMA);
    var affData  = affSheet.getDataRange().getValues();
    var headers  = affData[0];

    var colId         = headers.indexOf('id');
    var colSeller     = headers.indexOf('seller_id');
    var colRef        = headers.indexOf('ref_code');
    var colType       = headers.indexOf('type');
    var colCommPct    = headers.indexOf('commission_pct');
    var colConversions= headers.indexOf('conversions');
    var colEarnings   = headers.indexOf('earnings');
    var colStatus     = headers.indexOf('status');

    var foundRow    = -1;
    var sellerId    = null;
    var commPct     = 0;

    for (var i = 1; i < affData.length; i++) {
      if (String(affData[i][colRef]).toUpperCase() === refCode &&
          affData[i][colStatus] === 'active') {
        foundRow = i + 1;
        sellerId = affData[i][colSeller];
        commPct  = Number(affData[i][colCommPct]) || 0;
        break;
      }
    }

    if (foundRow === -1) return { success: false };

    var commission = orderTotal * commPct;

    // Mise à jour des stats de l'affilié
    var curConv     = Number(affSheet.getRange(foundRow, colConversions + 1).getValue()) || 0;
    var curEarnings = Number(affSheet.getRange(foundRow, colEarnings   + 1).getValue()) || 0;

    affSheet.getRange(foundRow, colConversions + 1).setValue(curConv + 1);
    affSheet.getRange(foundRow, colEarnings    + 1).setValue(curEarnings + commission);

    // Log conversion
    var convSheet = getOrInitTable(TABLE_AFFILIATE_CONVERSIONS, AFFILIATE_CONVERSIONS_SCHEMA);
    convSheet.appendRow([
      'CONV-' + Date.now(), null, refCode, sellerId,
      buyerId, orderId, orderTotal,
      commission, 'pending', new Date()
    ]);

    // Créditer le wallet affilié (si applicable)
    if (commission > 0) {
      _creditAffiliateWallet(sellerId, commission, orderId);
    }

    return { success: true, commission: commission };

  } catch(e) {
    Logger.log('❌ recordAffiliateConversion: ' + e.toString());
    return { success: false };
  }
}

/**
 * Crédite le wallet du vendeur/affilié avec la commission gagnée.
 * @private
 */
function _creditAffiliateWallet(userId, amount, orderId) {
  try {
    var walletSheet = SpreadsheetApp.getActiveSpreadsheet()
                        .getSheetByName('seller_wallet');
    if (!walletSheet) return;

    var walletData = walletSheet.getDataRange().getValues();
    var headers    = walletData[0];
    var colId      = headers.indexOf('seller_id');
    var colBal     = headers.indexOf('balance');

    for (var i = 1; i < walletData.length; i++) {
      if (String(walletData[i][colId]) === String(userId)) {
        var newBal = (Number(walletData[i][colBal]) || 0) + amount;
        walletSheet.getRange(i + 1, colBal + 1).setValue(newBal);
        return;
      }
    }
    // Créer une entrée si inexistante
    walletSheet.appendRow([userId, amount, 0, new Date()]);
  } catch(e) {
    Logger.log('⚠️ _creditAffiliateWallet: ' + e.toString());
  }
}

/**
 * Hash simple d'une IP pour anonymisation (RGPD-friendly).
 * @private
 */
function _hashIp(ip) {
  if (!ip) return '';
  var hash = 0;
  for (var i = 0; i < ip.length; i++) {
    hash = ((hash << 5) - hash) + ip.charCodeAt(i);
    hash |= 0;
  }
  return 'h' + Math.abs(hash).toString(16);
}


// ── 4. TABLEAU DE BORD AFFILIÉS (VENDEUR) ───────────────────

/**
 * Retourne toutes les statistiques d'affiliation pour un vendeur.
 * Utilisé par le panneau "Mes Affiliés" dans Seller Central.
 *
 * @param {string} sellerId
 * @returns {Object} - { link, ref_code, stats, clicks_by_src, top_days, conversions }
 */
function getAffiliateStats(sellerId) {
  try {
    // 1. Récupérer ou créer le code affilié du vendeur
    var codeData = getOrCreateAffiliateCode(sellerId, 'seller');

    // 2. Statistiques des clics des 30 derniers jours
    var clickSheet = getOrInitTable(TABLE_AFFILIATE_CLICKS, AFFILIATE_CLICKS_SCHEMA);
    var clickData  = clickSheet.getDataRange().getValues();
    var headers    = clickData[0];

    var colRef       = headers.indexOf('ref_code');
    var colSrc       = headers.indexOf('src');
    var colTimestamp = headers.indexOf('timestamp');
    var colConverted = headers.indexOf('converted');

    var thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    var clicksBySrc  = {};
    var clicksByDay  = {};
    var totalClicks  = 0;
    var refCode      = (codeData.ref_code || '').toUpperCase();

    for (var i = 1; i < clickData.length; i++) {
      if (String(clickData[i][colRef]).toUpperCase() !== refCode) continue;

      var ts = new Date(clickData[i][colTimestamp]);
      if (ts < thirtyDaysAgo) continue;

      totalClicks++;

      var src = clickData[i][colSrc] || 'direct';
      clicksBySrc[src] = (clicksBySrc[src] || 0) + 1;

      var day = Utilities.formatDate(ts, 'UTC', 'yyyy-MM-dd');
      clicksByDay[day] = (clicksByDay[day] || 0) + 1;
    }

    // 3. Conversions
    var convSheet = getOrInitTable(TABLE_AFFILIATE_CONVERSIONS, AFFILIATE_CONVERSIONS_SCHEMA);
    var convData  = convSheet.getDataRange().getValues();
    var convHdrs  = convData[0];

    var colCRef    = convHdrs.indexOf('ref_code');
    var colOTotal  = convHdrs.indexOf('order_total');
    var colComm    = convHdrs.indexOf('commission_earned');
    var colCDate   = convHdrs.indexOf('created_at');

    var conversions      = [];
    var totalCommissions = 0;

    for (var j = 1; j < convData.length; j++) {
      if (String(convData[j][colCRef]).toUpperCase() !== refCode) continue;
      totalCommissions += Number(convData[j][colComm]) || 0;
      conversions.push({
        order_total: convData[j][colOTotal],
        commission:  convData[j][colComm],
        date:        convData[j][colCDate]
      });
    }

    // 4. Top jours (tri décroissant)
    var topDays = Object.keys(clicksByDay)
      .map(function(d) { return { date: d, clicks: clicksByDay[d] }; })
      .sort(function(a, b) { return b.clicks - a.clicks; })
      .slice(0, 7);

    return {
      success:          true,
      ref_code:         codeData.ref_code,
      share_link:       codeData.link,
      product_link:     codeData.product_link,
      total_clicks:     totalClicks,
      total_conversions: conversions.length,
      total_commissions: Math.round(totalCommissions * 100) / 100,
      clicks_by_src:    clicksBySrc,
      top_days:         topDays,
      recent_conversions: conversions.slice(-10).reverse()
    };

  } catch(e) {
    Logger.log('❌ getAffiliateStats: ' + e.toString());
    return { success: false, message: e.toString() };
  }
}

/**
 * Génère plusieurs liens partageables pré-formatés pour réseaux sociaux.
 * @param {string} sellerId
 * @returns {Object} - { whatsapp, facebook, instagram_bio, sms, copy }
 */
function getSharableLinks(sellerId) {
  try {
    var codeData  = getOrCreateAffiliateCode(sellerId, 'seller');
    var scriptUrl = ScriptApp.getService().getUrl();

    // Profil vendeur pour personnaliser le message
    var profile   = getSellerProfilePro(sellerId);
    var storeName = profile.name || 'Ma Boutique';

    var storeLink = scriptUrl + '?v=store&s=' + sellerId + '&ref=' + codeData.ref_code;

    var waText    = encodeURIComponent(
      '🛍️ Découvrez ' + storeName + ' sur Mache Kretyen !\n' +
      'Achetez directement ici 👇\n' + storeLink
    );

    return {
      success:       true,
      store_link:    storeLink,
      whatsapp:      'https://wa.me/?text=' + waText,
      facebook:      'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(storeLink),
      sms:           'sms:?body=' + encodeURIComponent('Boutique: ' + storeLink),
      copy:          storeLink,
      ref_code:      codeData.ref_code
    };

  } catch(e) {
    return { success: false, message: e.toString() };
  }
}


// ── 5. STOREFRONT PUBLIC ENRICHI ─────────────────────────────

/**
 * Retourne le profil complet d'un storefront public,
 * incluant les données pour le partage (og:tags, etc.).
 * Version améliorée de getSellerProfilePro().
 *
 * @param {string} sellerId
 * @returns {Object} - profil enrichi avec og_data, share_links, products_count
 */
function getPublicStorefront(sellerId) {
  try {
    var profile = getSellerProfilePro(sellerId);

    // Compter les produits actifs
    var prodSheet = SpreadsheetApp.getActiveSpreadsheet()
                      .getSheetByName('products');
    var productsCount = 0;
    var featuredProducts = [];

    if (prodSheet) {
      var prodData = prodSheet.getDataRange().getValues();
      var pHdrs    = prodData[0];
      var pVendor  = pHdrs.indexOf('vendor_id');
      var pTitle   = pHdrs.indexOf('title');
      var pPrice   = pHdrs.indexOf('price');
      var pImages  = pHdrs.indexOf('images');
      var pId      = pHdrs.indexOf('id');
      var pStock   = pHdrs.indexOf('stock');

      for (var i = 1; i < prodData.length; i++) {
        if (String(prodData[i][pVendor]) === String(sellerId)) {
          productsCount++;
          if (featuredProducts.length < 3 && Number(prodData[i][pStock]) > 0) {
            var imgs = [];
            try { imgs = JSON.parse(prodData[i][pImages] || '[]'); } catch(e) {}
            featuredProducts.push({
              id:    prodData[i][pId],
              title: prodData[i][pTitle],
              price: prodData[i][pPrice],
              thumb: imgs[0] || ''
            });
          }
        }
      }
    }

    // Données Open Graph pour le partage
    var scriptUrl = ScriptApp.getService().getUrl();
    var storeLink = scriptUrl + '?v=store&s=' + sellerId;
    var ogImage   = profile.extended && profile.extended.banner
                    ? profile.extended.banner
                    : (profile.logo || '');

    profile.og_data = {
      title:       profile.name + ' — Mache Kretyen',
      description: profile.description ||
                   productsCount + ' produits disponibles. Achetez maintenant !',
      image:       ogImage,
      url:         storeLink
    };

    profile.share_stats = {
      products_count: productsCount,
      rating:         profile.rating,
      reviews:        profile.reviews,
      sales:          profile.sales
    };

    profile.featured_products = featuredProducts;

    return profile;

  } catch(e) {
    Logger.log('❌ getPublicStorefront: ' + e.toString());
    return { success: false, message: e.toString() };
  }
}


// ── 6. INTÉGRATION DANS saveOrder() ──────────────────────────
// ⚠️  INSTRUCTION D'INTÉGRATION :
//     Dans votre fonction saveOrder() existante, ajoutez cet appel
//     juste après la ligne sheet.appendRow([...]) :
//
//     // Attribution affilié
//     if (o.ref_code) {
//       recordAffiliateConversion(newOrderId, o.buyer_id, o.total_price, o.ref_code);
//     }
//
// ⚠️  Ajoutez aussi 'ref_code' dans ORDER_SCHEMA si absent.


// ── 7. UTILITAIRES ───────────────────────────────────────────

/**
 * Valide qu'un ref_code existe et est actif.
 * @param {string} refCode
 * @returns {Object|null} - données de l'affilié, ou null si invalide
 */
function validateRefCode(refCode) {
  try {
    if (!refCode) return null;
    refCode = String(refCode).trim().toUpperCase();

    var sheet = getOrInitTable(TABLE_AFFILIATES, AFFILIATE_SCHEMA);
    var data  = sheet.getDataRange().getValues();
    var hdrs  = data[0];

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][hdrs.indexOf('ref_code')]).toUpperCase() === refCode &&
          data[i][hdrs.indexOf('status')] === 'active') {
        return {
          ref_code:  refCode,
          seller_id: data[i][hdrs.indexOf('seller_id')],
          type:      data[i][hdrs.indexOf('type')]
        };
      }
    }
    return null;
  } catch(e) {
    return null;
  }
}

/**
 * Retourne un classement des meilleurs affiliés (pour admin).
 * @returns {Array} - Top 20 affiliés triés par conversions
 */
function getTopAffiliates() {
  try {
    var sheet = getOrInitTable(TABLE_AFFILIATES, AFFILIATE_SCHEMA);
    var data  = sheet.getDataRange().getValues();
    var hdrs  = data[0];

    var results = [];
    for (var i = 1; i < data.length; i++) {
      results.push({
        seller_id:   data[i][hdrs.indexOf('seller_id')],
        ref_code:    data[i][hdrs.indexOf('ref_code')],
        type:        data[i][hdrs.indexOf('type')],
        clicks:      Number(data[i][hdrs.indexOf('clicks')])      || 0,
        conversions: Number(data[i][hdrs.indexOf('conversions')]) || 0,
        earnings:    Number(data[i][hdrs.indexOf('earnings')])    || 0
      });
    }

    return results
      .sort(function(a, b) { return b.conversions - a.conversions; })
      .slice(0, 20);

  } catch(e) {
    return [];
  }
}
/**
 * Enregistre une demande de retrait en base de données
 */
function submitWithdrawalRequest(userId, amount) {
  try {
    // 1. Enregistrer dans la table des retraits
    var payoutSheet = getOrInitTable('payouts', ['id', 'user_id', 'amount', 'status', 'date']);
    payoutSheet.appendRow(['POUT-' + Date.now(), userId, amount, 'En attente', new Date()]);
    
    // 2. Réinitialiser le solde dans la table 'affiliates'
    var affSheet = getOrInitTable('affiliates', AFFILIATE_SCHEMA);
    var data = affSheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][1]) === String(userId)) {
        affSheet.getRange(i + 1, 8).setValue(0); // Colonne H (earnings) remise à 0
        break;
      }
    }
    return { success: true };
  } catch (e) {
    throw new Error("Erreur serveur retrait : " + e.message);
  }
}