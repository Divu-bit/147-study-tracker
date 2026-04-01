const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    linkCode: { type: String, unique: true, required: true, index: true },
    chatId: { type: Number, default: null }, // Telegram reference
    appUserId: { type: String, default: null }, // Universal Bridge reference
    notificationPreference: { type: String, enum: ['telegram', 'app'], default: 'telegram' },
    linked: { type: Boolean, default: false },
    linkedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
