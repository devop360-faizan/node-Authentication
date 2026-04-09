const prisma = require("../prisma/client");
const bcrypt = require("bcrypt");
const e = require("express");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");

exports.register = async (req, res) => {
  try {
    const email = req.body?.email;
    const password = req.body?.password;
    if (!email || !password) { return res.status(400).json({ message: "Email and password are required" }); }
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) { return res.status(400).json({ message: "User already exists" }); }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { email, password: hashedPassword }, });
    res.status(201).json({ message: "User created successfully", user });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ message: "Server error", error: error.message, stack: error.stack, });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) { return res.status(400).json({ message: "Email and password are required" }); }
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) { return res.status(400).json({ message: "Invalid credentials" }); }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) { return res.status(400).json({ message: "Invalid credentials" }); }

    // 1. Generate short-lived Access Token (e.g. 15 minutes)
    const accessToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: "15m" });

    // 2. Generate long-lived Refresh Token (e.g. 7 days)
    const refreshToken = jwt.sign({ id: user.id }, process.env.JWT_REFRESH_SECRET, { expiresIn: "7d" });

    // 3. Save Refresh Token in Database
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: expiresAt
      }
    });

    const { password: _, ...userData } = user;
    res.json({
      success: true,
      message: "Login successful",
      user: userData,
      accessToken: accessToken,
      refreshToken: refreshToken
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};


const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || "sandbox.smtp.mailtrap.io",
  port: process.env.EMAIL_PORT || 2525,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});


exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) { return res.status(400).json({ message: "Email is required" }); }
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) { return res.status(400).json({ message: "User not found" }); }
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await prisma.otp.deleteMany({ where: { email } });
    await prisma.otp.create({
      data: { email, otp, expiresAt },
    });
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Password Reset OTP",
      text: `Your OTP for password reset is ${otp}. It expires in 10 minutes.`,
    });
    res.json({ message: "OTP sent to email (functionality not implemented)" });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ message: "Server error", error: error.message, stack: error.stack, });
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) { return res.status(400).json({ message: "Email and OTP are required " }) }
    const record = await prisma.otp.findFirst({ where: { email, otp } });
    if (!record) { return res.status(400).json({ message: "Invalid OTP" }) }
    if (record.expiresAt < new Date()) { return res.status(400).json({ message: "OTP expired" }) }
    // Removed: await prisma.otp.deleteMany({ where: { email } });
    res.json({ message: "OTP verified successfully" });
  } catch (error) {
    console.error("Verify OTP error:", error);
    res.status(500).json({ message: "Server error", error: error.message, stack: error.stack });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) { return res.status(400).json({ message: "Email, OTP and new password are required" }) }
    const record = await prisma.otp.findFirst({ where: { email, otp } });
    if (!record) { return res.status(400).json({ message: "Invalid OTP" }) }
    if (record.expiresAt < new Date()) { return res.status(400).json({ message: "OTP expired" }) }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { email }, data: { password: hashedPassword } });
    await prisma.otp.deleteMany({ where: { email } });
    res.json({ message: "Password reset successfully" });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ message: "Server error", error: error.message, stack: error.stack });
  }
}


exports.logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) { return res.status(400).json({ message: "Refresh token is required" }) }

    // Check if it exists first to stop fake logouts
    const exists = await prisma.refreshToken.findUnique({
      where: { token: refreshToken }
    });

    if (!exists) {
      return res.status(400).json({ message: "Invalid refresh token" });
    }

    // Delete the refresh token from the DB so it can no longer be used to generate new access tokens
    await prisma.refreshToken.deleteMany({
      where: { token: refreshToken },
    });

    res.json({ message: "Logout successful" });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ message: "Server error", error: error.message, stack: error.stack });
  }
}

// ---------------------- //
// Generate New Access Token via Refresh Token
// ---------------------- //
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(401).json({ message: "Refresh token is required!" });
    }

    // 1. Check if refresh token actually exists in our Database
    const tokenInDb = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
    });

    if (!tokenInDb) {
      return res.status(403).json({ message: "Refresh token is not in DB. Please login again." });
    }
    jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET, (err, decoded) => {
      if (err) {
        prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
        return res.status(403).json({ message: "Refresh token was expired or disabled." });
      }

      const newAccessToken = jwt.sign(
        { id: decoded.id },
        process.env.JWT_SECRET,
        { expiresIn: "2m" }
      );

      res.status(200).json({
        message: "New Access Token generated",
        accessToken: newAccessToken,
      });
    });
  } catch (error) {
    console.error("Refresh token error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
}