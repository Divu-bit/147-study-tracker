const mongoose = require('mongoose');

const entrySchema = new mongoose.Schema({
    linkCode: { type: String, required: true, index: true },
    date: { type: String, required: true },
    subject: { type: String, required: true },
    topic: { type: String, required: true },
    notes: { type: String, default: '' },
    revisions: {
        day4: {
            dueDate: { type: String, required: true },
            completed: { type: Boolean, default: false },
            completedAt: { type: Date, default: null }
        },
        day7: {
            dueDate: { type: String, required: true },
            completed: { type: Boolean, default: false },
            completedAt: { type: Date, default: null }
        }
    }
}, { timestamps: true });

module.exports = mongoose.model('Entry', entrySchema);
