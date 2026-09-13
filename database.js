import mongoose from "mongoose";

const MONGO_URI = "mongodb+srv://prxcaptain_db_user:XAIml399UD1X4073@cluster0.tgn2pgm.mongodb.net/?appName=Cluster0";

let isConnected = false;

export async function connectDB() {
    if (isConnected) return;
    try {
        await mongoose.connect(MONGO_URI, {
            serverSelectionTimeoutMS: 5000,
        });
        isConnected = true;
        console.log("✅ Connected to MongoDB successfully!");
    } catch (error) {
        console.error("❌ MongoDB Connection Error:", error);
        throw error;
    }
}

const sessionSchema = new mongoose.Schema({
    sessionId: { type: String, required: true, unique: true },
    creds: { type: Object, required: true },
    createdAt: { type: Date, default: Date.now, expires: 604800 } // Auto delete after 7 days if unused
});

const SessionModel = mongoose.model("Session", sessionSchema);

export async function saveSessionToMongo(sessionId, credsPath) {
    await connectDB();
    const fs = await import("fs");
    const credsData = JSON.parse(fs.readFileSync(credsPath, "utf8"));

    await SessionModel.findOneAndUpdate(
        { sessionId },
        { creds: credsData },
        { upsert: true, new: true }
    );
    console.log("✅ Session saved to MongoDB for ID:", sessionId);
}
