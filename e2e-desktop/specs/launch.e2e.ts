// Desktop smoke: the app launches and shows its shell. Scaffold — expand to
// the 3-5 critical paths (record→transcript visible, settings persist) once
// @wdio/tauri-service is installed and a debug binary is built.
describe("Miting desktop — smoke", () => {
  it("launches and renders the window", async () => {
    // A minimal presence check; refine selectors against the built UI.
    const body = await $("body");
    await expect(body).toBeExisting();
  });
});
