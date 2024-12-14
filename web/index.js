// @ts-check
import { join } from "path";
import { readFileSync } from "fs";
import express from "express";
import serveStatic from "serve-static";

import shopify from "./shopify.js";
import productCreator from "./product-creator.js";
import PrivacyWebhookHandlers from "./privacy.js";
import connection from "./database/connection.js";


const PORT = process.env.PORT || 5000;
console.log("port",PORT)

const STATIC_PATH =
  process.env.NODE_ENV === "production"
    ? `${process.cwd()}/frontend/dist`
    : `${process.cwd()}/frontend/`;

const app = express();
export async function storeShopSession(shop, accessToken, scope) {
  try {
    await connection.query(
      "INSERT INTO shop_sessions (shop, access_token, scope) VALUES (?, ?, ?)",
      [shop, accessToken, scope]
    );
  } catch (error) {
    console.error("Error storing session:", error);
    throw error; // Re-throw the error so it can be handled in the caller
  }
}
// Set up Shopify authentication and webhook handling
app.get(shopify.config.auth.path, shopify.auth.begin());
app.get(
  shopify.config.auth.callbackPath,
  shopify.auth.callback(),
  async (req, res) => {
    console.log("Shopify authentication successful:", res.locals.shopify);

    const { shop, accessToken, scope } = res.locals.shopify.session;

    try {
      // Store session data using the separate function
      await storeShopSession(shop, accessToken, scope);
      res.locals.shopify.shop = shop; // Ensure that the shop is set in res.locals
      const thirdPartyUrl = `https://www.phanomprofessionals.com?shop=${shop}`;
      res.redirect(thirdPartyUrl);    } catch (error) {
      console.error("Error storing session:", error);
      res.status(500).send("Error storing session");
    }
  }
);

app.post(
  shopify.config.webhooks.path,
  shopify.processWebhooks({ webhookHandlers: PrivacyWebhookHandlers })
);

// If you are adding routes outside of the /api path, remember to
// also add a proxy rule for them in web/frontend/vite.config.js

app.use("/api/*", shopify.validateAuthenticatedSession());

app.use(express.json());

app.get("/api/products/count", async (_req, res) => {
  const client = new shopify.api.clients.Graphql({
    session: res.locals.shopify.session,
  });

  const countData = await client.request(`
    query shopifyProductCount {
      productsCount {
        count
      }
    }
  `);

  res.status(200).send({ count: countData.data.productsCount.count });
});

app.post("/api/products", async (_req, res) => {
  let status = 200;
  let error = null;

  try {
    await productCreator(res.locals.shopify.session);
  } catch (e) {
    console.log(`Failed to process products/create: ${e.message}`);
    status = 500;
    error = e.message;
  }
  res.status(status).send({ success: status === 200, error });
});

app.use(shopify.cspHeaders());
app.use(serveStatic(STATIC_PATH, { index: false }));

// @ts-ignore
app.use("/*", shopify.ensureInstalledOnShop(), async (_req, res, _next) => {
  return res
    .status(200)
    .set("Content-Type", "text/html")
    .send(
      readFileSync(join(STATIC_PATH, "index.html"))
        .toString()
        .replace("%VITE_SHOPIFY_API_KEY%", process.env.SHOPIFY_API_KEY || "")
    );
});
console.log("process.env.SHOPIFY_API_KEY",process.env.SHOPIFY_API_KEY)
// @ts-ignore

app.get('/', async (req, res) => {
  res.send('<h1>Welcome to Your Shopify App</h1>');
});


app.listen(PORT, () => {
  console.log(`Server is running on ${PORT} `);
});


