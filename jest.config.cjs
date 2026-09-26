module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/test/**/*.spec.ts"],
  testPathIgnorePatterns: ["\\.integration\\.spec\\.ts$"],
  clearMocks: true,
};
