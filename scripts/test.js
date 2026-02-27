import { postToSNS } from "../src/bot.js";

const testData = {
    platforms: ["x"],
    text: "Hello from standalone KALEI SNS Bot! #KPOP #AI",
    imageUrls: ["https://firebasestorage.googleapis.com/v0/b/my-style-5649d.appspot.com/o/samples%2Fsample_outfit.png?alt=media"]
};

console.log("Starting test post...");
postToSNS(testData).then(results => {
    console.log("Results:", JSON.stringify(results, null, 2));
    console.log("Check .env if success is false.");
});
