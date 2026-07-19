import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";

import { createRemoteJWKSet, jwtVerify } from "jose";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
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
    // API CALL
    // ============================================

    app.post("/api/ideas/:id/validate", async (req, res) => {
      try {
        const { id } = req.params;

        const idea = await ideasCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!idea) {
          return res.status(404).json({
            success: false,
            message: "Idea not found",
          });
        }

        const prompt = `
You are an experienced startup mentor, venture capitalist, and product strategist.

Analyze the startup idea below and return ONLY valid JSON.
Do NOT include markdown, explanations, or code fences.

Startup Idea

Title:
${idea.title}

Short Description:
${idea.shortDescription}

Description:
${idea.description}

Category:
${idea.category}

Evaluation Rules

1. Score each category from 0 to 20.

- innovation
- marketDemand
- businessViability
- technicalFeasibility
- scalability

2. overallScore MUST equal the sum of those five scores.

3. overallScore MUST be an integer between 0 and 100.

4. Use these values only:

marketPotential:
- Low
- Medium
- High

technicalDifficulty:
- Low
- Medium
- High

competitionLevel:
- Low
- Medium
- High

5. strengths must contain 3-5 items.

6. weaknesses must contain 3-5 items.

7. risks must contain 3-5 items.

8. recommendations must contain 3-5 actionable suggestions.

9. verdict should be a short paragraph (2-4 sentences).

Return EXACTLY this JSON:

{
  "overallScore": 0,
  "innovation": 0,
  "marketDemand": 0,
  "businessViability": 0,
  "technicalFeasibility": 0,
  "scalability": 0,
  "marketPotential": "",
  "technicalDifficulty": "",
  "competitionLevel": "",
  "strengths": [],
  "weaknesses": [],
  "risks": [],
  "recommendations": [],
  "verdict": ""
}
`;

        const response = await ai.models.generateContent({
          model: "gemini-flash-latest",
          contents: prompt,
        });

        const report = JSON.parse(
          response.text
            .replace(/```json/g, "")
            .replace(/```/g, "")
            .trim(),
        );

        await ideasCollection.updateOne(
          {
            _id: new ObjectId(id),
          },
          {
            $set: {
              validationReport: report,
              validatedAt: new Date(),
            },
          },
        );

        res.status(200).json({
          success: true,
          validationReport: report,
        });
      } catch (error) {
        console.error(error);

        res.status(500).json({
          success: false,
          message: error.message,
        });
      }
    });

    app.post("/api/ideas/:id/improve", async (req, res) => {
      try {
        const { id } = req.params;

        const idea = await ideasCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!idea) {
          return res.status(404).json({
            success: false,
            message: "Idea not found",
          });
        }

        const prompt = `
You are a successful startup founder, product strategist, and investor.

Your job is to improve the startup idea below.

Title:
${idea.title}

Short Description:
${idea.shortDescription}

Description:
${idea.description}

Category:
${idea.category}

Return ONLY valid JSON.

Rules:
- Make the title stronger but realistic.
- Rewrite the short description professionally.
- Rewrite the full description with more clarity.
- Suggest 5 useful features.
- Suggest 4 target customer groups.
- Suggest the best business model.
- Suggest 5 go-to-market strategies.
- Suggest 5 marketing ideas.

Return EXACTLY this structure:

{
  "improvedTitle":"",
  "improvedShortDescription":"",
  "improvedDescription":"",
  "newFeatures":[],
  "targetCustomers":[],
  "businessModel":"",
  "goToMarket":[],
  "marketingIdeas":[]
}
`;

        const response = await ai.models.generateContent({
          model: "gemini-flash-latest",
          contents: prompt,
        });

        const report = JSON.parse(
          response.text
            .replace(/```json/g, "")
            .replace(/```/g, "")
            .trim(),
        );

        await ideasCollection.updateOne(
          {
            _id: new ObjectId(id),
          },
          {
            $set: {
              improvementReport: report,
              improvedAt: new Date(),
            },
          },
        );

        res.send({
          success: true,
          improvementReport: report,
        });
      } catch (error) {
        console.log(error);

        res.status(500).send({
          success: false,
          message: error.message,
        });
      }
    });

    // ============================================
    // FEATURED IDEAS
    // ============================================

    app.get("/api/featured-ideas", async (req, res) => {
      try {
        const ideas = await ideasCollection
          .find({})
          .sort({ createdAt: -1 })
          .limit(3)
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

        const totalCategories = new Set(ideas.map((idea) => idea.category))
          .size;

        res.send({
          totalIdeas,
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
