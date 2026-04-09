const router = require("express").Router();
const postController = require("../controllers/postController");
const authMiddleware = require("../middleware/authMiddleware");

router.get("/", postController.getAllPosts);
router.post("/", authMiddleware, postController.createPost);
// router.get("/:id", postController.getPostById);
// router.put("/:id", postController.updatePost);
// router.delete("/:id", postController.deletePost);

module.exports = router;