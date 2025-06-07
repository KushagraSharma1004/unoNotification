// backend/server.js
const express = require('express');
const webpush = require('web-push');
const bodyParser = require('body-parser');
const cors = require('cors'); // For development, handle CORS properly in production
const dotenv = require('dotenv'); // To load environment variables from .env

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(bodyParser.json());
// Configure CORS: In production, replace '*' with your frontend's domain (e.g., 'https://vendors.unoshops.com')
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173' // Adjust this for your React app's URL
}));

// --- VAPID Keys Setup ---
// IMPORTANT: For production, generate these ONCE and store them securely
// in environment variables (e.g., in a .env file, or your hosting provider's config).
// DO NOT regenerate them every time the server starts in production.

let VAPID_PUBLIC_KEY;
let VAPID_PRIVATE_KEY;

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
    VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
    console.log("VAPID keys loaded from environment variables.");
} else {
    // Generate VAPID keys only if they are not found in environment variables.
    // This is primarily for initial setup/development.
    // In production, ensure they are set as env vars.
    const vapidKeys = webpush.generateVAPIDKeys();
    VAPID_PUBLIC_KEY = vapidKeys.publicKey;
    VAPID_PRIVATE_KEY = vapidKeys.privateKey;
    console.warn("WARNING: VAPID keys not found in environment variables. New keys generated.");
    console.warn("Please save these to your .env file for production:");
    console.warn(`VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY}`);
    console.warn(`VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY}`);
}

const YOUR_EMAIL = process.env.WEB_PUSH_EMAIL || 'mailto:admin@unoshops.com'; // Important for push service to contact you

webpush.setVapidDetails(
    YOUR_EMAIL,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
);

// In a real application, you'd use a database (e.g., MongoDB, PostgreSQL)
// to store subscriptions. For this example, we'll use an in-memory Map.
// Key: vendorId, Value: Array of PushSubscription objects
const subscriptions = new Map();

// --- API Endpoints ---

// Endpoint to send the VAPID public key to the frontend
app.get('/api/vapid-public-key', (req, res) => {
    res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// Endpoint to receive push subscriptions from the frontend
app.post('/api/subscribe', (req, res) => {
    const { subscription, vendorId } = req.body;

    if (!subscription || !vendorId) {
        return res.status(400).json({ error: 'Missing subscription or vendorId' });
    }

    // Store the subscription. A vendor might have multiple devices/browsers subscribed.
    if (!subscriptions.has(vendorId)) {
        subscriptions.set(vendorId, []);
    }
    // Check if subscription already exists to avoid duplicates
    const vendorSubs = subscriptions.get(vendorId);
    if (!vendorSubs.some(sub => sub.endpoint === subscription.endpoint)) {
        vendorSubs.push(subscription);
        console.log(`Vendor ${vendorId} subscribed. Total subscriptions: ${vendorSubs.length}`);
    } else {
        console.log(`Vendor ${vendorId} already subscribed with this endpoint.`);
    }

    res.status(201).json({ message: 'Subscription received' });
});

// Endpoint to simulate a new order (replace with your actual order creation logic)
app.post('/api/new-order', async (req, res) => {
    // In your actual application, this logic would be triggered when a new order is
    // successfully processed and saved in your database for a specific vendor.
    const { vendorId, orderId, customerName, orderTotal } = req.body;

    if (!vendorId || !orderId || !customerName || !orderTotal) {
        return res.status(400).json({ error: 'Missing order details' });
    }

    console.log(`New order received for vendor ${vendorId}: Order #${orderId} from ${customerName}`);

    const vendorSubscriptions = subscriptions.get(vendorId);

    if (!vendorSubscriptions || vendorSubscriptions.length === 0) {
        console.log(`No active push subscriptions for vendor ${vendorId}.`);
        return res.status(200).json({ message: 'No active subscriptions for vendor.' });
    }

    const payload = JSON.stringify({
        title: `New Order! #${orderId}`,
        body: `From: ${customerName}, Total: ₹${orderTotal}`,
        url: `https://vendors.unoshops.com/AllOrders/?${orderId}` // Deep link to order details
    });

    // Send push notification to all subscribed devices for this vendor
    const notificationsPromises = vendorSubscriptions.map(async (sub) => {
        try {
            await webpush.sendNotification(sub, payload);
            console.log(`Push notification sent to vendor ${vendorId} (endpoint: ${sub.endpoint}).`);
            return { success: true, endpoint: sub.endpoint };
        } catch (error) {
            console.error(`Error sending push to vendor ${vendorId} (endpoint: ${sub.endpoint}):`, error);
            // Handle cases where subscription is no longer valid (e.g., user revoked permission)
            if (error.statusCode === 410) { // GONE - subscription no longer valid
                console.log(`Removing invalid subscription for vendor ${vendorId}: ${sub.endpoint}`);
                // In a real app, you MUST remove this specific 'sub' from your database
                return { success: false, endpoint: sub.endpoint, invalid: true };
            }
            return { success: false, endpoint: sub.endpoint, error: error.message };
        }
    });

    const results = await Promise.all(notificationsPromises);

    // Filter out invalid subscriptions from the in-memory map
    const validSubscriptions = vendorSubscriptions.filter((sub, index) => !results[index].invalid);
    subscriptions.set(vendorId, validSubscriptions); // Update the map

    res.status(200).json({ message: 'Notifications processing complete.', results });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Node.js Push Server running on port ${PORT}`);
    console.log(`Access backend at http://localhost:${PORT}`);
});