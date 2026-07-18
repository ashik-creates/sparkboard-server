import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import {
  MongoClient,
  ObjectId,
  ServerApiVersion,
} from "mongodb";

import {
  createRemoteJWKSet,
  jwtVerify,
} from "jose";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`)
);

async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({
      message: "Unauthorized",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const { payload } = await jwtVerify(token, JWKS);

    req.user = payload;

    next();
  } catch (error) {
    console.log(error);

    return res.status(401).send({
      message: "Unauthorized",
    });
  }
}

async function run() {
  try {
    await client.connect();

    const db = client.db("sparkboard");

    const ideasCollection = db.collection("ideas");

    app.get("/", (req, res) => {
      res.send("🚀 SparkBoard API Running...");
    });

    // ============================================
    // GET ALL IDEAS
    // ============================================

    app.get("/api/ideas", async (req, res) => {
      const {
        search = "",
        category = "",
        sort = "newest",
        page = "1",
        limit = "8",
      } = req.query;

      const query = {};

      if (search) {
        query.title = {
          $regex: search,
          $options: "i",
        };
      }

      if (category && category !== "All") {
        query.category = category;
      }

      let sortOption = {
        createdAt: -1,
      };

      if (sort === "oldest") {
        sortOption = {
          createdAt: 1,
        };
      }

      const currentPage = Number(page);
      const perPage = Number(limit);

      const skip = (currentPage - 1) * perPage;

      const ideas = await ideasCollection
        .find(query)
        .sort(sortOption)
        .skip(skip)
        .limit(perPage)
        .toArray();

      const total = await ideasCollection.countDocuments(query);

      res.send({
        ideas,
        total,
        totalPages: Math.ceil(total / perPage),
        currentPage,
      });
    });

    // ============================================
    // GET SINGLE IDEA
    // ============================================

    app.get("/api/ideas/:id", async (req, res) => {
      const { id } = req.params;

      const idea = await ideasCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!idea) {
        return res.status(404).send({
          message: "Idea not found",
        });
      }

      res.send(idea);
    });

        // ============================================
    // FEATURED IDEAS
    // ============================================

    app.get("/api/featured-ideas", async (req, res) => {
      try {
        const ideas = await ideasCollection
          .find({})
          .sort({ createdAt: -1 })
          .limit(4)
          .toArray();

        res.send(ideas);
      } catch (error) {
        console.error(error);

        res.status(500).send({
          message: "Failed to fetch featured ideas.",
        });
      }
    });

    // ============================================
    // STATISTICS
    // ============================================

    app.get("/api/statistics", async (req, res) => {
      try {
        const ideas = await ideasCollection.find().toArray();

        const totalIdeas = ideas.length;

        const publicIdeas = ideas.filter(
          (idea) => idea.isPublic
        ).length;

        const privateIdeas = totalIdeas - publicIdeas;

        const totalCategories = new Set(
          ideas.map((idea) => idea.category)
        ).size;

        res.send({
          totalIdeas,
          publicIdeas,
          privateIdeas,
          totalCategories,
        });
      } catch (error) {
        console.error(error);

        res.status(500).send({
          message: "Failed to fetch statistics.",
        });
      }
    });

    // ============================================
    // CREATE IDEA
    // ============================================

    app.post("/api/ideas", verifyToken, async (req, res) => {
      try {
        const idea = {
          ...req.body,

          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const result = await ideasCollection.insertOne(idea);

        res.status(201).send({
          success: true,
          message: "Idea created successfully.",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error(error);

        res.status(500).send({
          success: false,
          message: "Failed to create idea.",
        });
      }
    });
        // ============================================
    // UPDATE IDEA
    // ============================================

    app.patch("/api/ideas/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;

        const updatedIdea = {
          ...req.body,
          updatedAt: new Date().toISOString(),
        };

        const result = await ideasCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: updatedIdea,
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({
            message: "Idea not found.",
          });
        }

        res.send({
          success: true,
          message: "Idea updated successfully.",
        });
      } catch (error) {
        console.error(error);

        res.status(500).send({
          success: false,
          message: "Failed to update idea.",
        });
      }
    });

    // ============================================
    // DELETE IDEA
    // ============================================

    app.delete("/api/ideas/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;

        const result = await ideasCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({
            message: "Idea not found.",
          });
        }

        res.send({
          success: true,
          message: "Idea deleted successfully.",
        });
      } catch (error) {
        console.error(error);

        res.status(500).send({
          success: false,
          message: "Failed to delete idea.",
        });
      }
    });

    console.log("✅ Connected to MongoDB");
  } catch (error) {
    console.error(error);
  }
}

run();

app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});