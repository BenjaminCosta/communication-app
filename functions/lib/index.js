"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncDirectoryOnContextWrite = exports.syncDirectoryOnContactWrite = exports.onMessageUpdated = exports.onMessageCreated = exports.onDailyCalendarReminders = exports.autoLinkOnUserEmailUpdate = exports.autoLinkOnRegister = void 0;
require("./shared/admin");
var contact_linking_1 = require("./auth/contact-linking");
Object.defineProperty(exports, "autoLinkOnRegister", { enumerable: true, get: function () { return contact_linking_1.autoLinkOnRegister; } });
Object.defineProperty(exports, "autoLinkOnUserEmailUpdate", { enumerable: true, get: function () { return contact_linking_1.autoLinkOnUserEmailUpdate; } });
var calendar_1 = require("./communications/calendar");
Object.defineProperty(exports, "onDailyCalendarReminders", { enumerable: true, get: function () { return calendar_1.onDailyCalendarReminders; } });
var notifications_1 = require("./communications/notifications");
Object.defineProperty(exports, "onMessageCreated", { enumerable: true, get: function () { return notifications_1.onMessageCreated; } });
Object.defineProperty(exports, "onMessageUpdated", { enumerable: true, get: function () { return notifications_1.onMessageUpdated; } });
var sync_1 = require("./directory/sync");
Object.defineProperty(exports, "syncDirectoryOnContactWrite", { enumerable: true, get: function () { return sync_1.syncDirectoryOnContactWrite; } });
Object.defineProperty(exports, "syncDirectoryOnContextWrite", { enumerable: true, get: function () { return sync_1.syncDirectoryOnContextWrite; } });
//# sourceMappingURL=index.js.map