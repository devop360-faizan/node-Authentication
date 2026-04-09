const express = require("express");
const prisma = require("../prisma/client");


exports.getAllPosts = async (req, res) => {
    try {
        const posts = await prisma.post.findMany();
        res.status(200).json({
            status: "success", message: "Posts retrieved successfully", results: posts.length, data: posts
        });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
}

exports.createPost = async (req, res) => {
    try {
        const { title, content } = req.body;
        if (!title || !content) {
            return res.status(400).json({ message: "Title and content are required" });
        }
        const userId = req.user.id;
        const post = await prisma.post.create({
            data: { title, content, userId: userId }
        });
        res.status(201).json({
            status: "success", message: "Post created successfully", data: post
        });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
}
