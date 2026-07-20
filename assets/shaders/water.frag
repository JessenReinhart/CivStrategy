// Water surface fragment shader (Phaser 3 Shader gameobject).
// NOTE: Phaser does NOT inject a `precision` qualifier for a raw fragment
// import. BaseShader only adds `precision mediump float;` when fragmentSrc
// is empty (BaseShader.js:44). So the fragment MUST declare its own
// precision, or GLSL ES compilation fails and create() throws before
// entity spawns. Do NOT remove the line below.
// Also use the quad-local varying `outTexCoord` (0..1), NOT `gl_FragCoord`
// (screen-space, drifts as the camera scrolls and samples the wrong
// heightmap texel -> water appears nowhere).

precision mediump float;

uniform float iTime;        // elapsed game time in seconds (driven from update)
uniform float waterLevel;   // height threshold; cells >= this are land
uniform sampler2D iChannel0; // heightmask: 1px-per-grid-cell grayscale (height*255)

// `outTexCoord` MUST be declared here: BaseShader only injects a default
// fragment (which declares it) when fragmentSrc is EMPTY (BaseShader.js:41-55).
// Our ?raw import is non-empty, so the fragment is used verbatim and must
// declare its own varying to match the default vertex shader (BaseShader.js:69).
varying vec2 outTexCoord;

void main() {
  // Quad-local coords align 1:1 with the heightmap texture, independent of
  // camera scroll/zoom, so the shoreline follows the terrain.
  vec2 uv = outTexCoord;

  // Height of the terrain cell underneath this fragment.
  float h = texture2D(iChannel0, uv).r;

  // Shoreline follows the heightmap: water only where the cell is below
  // the water level. Discard everything else (land shows through).
  if (h >= waterLevel) discard;

  // Animated sine waves (time-driven).
  vec2 wave = vec2(
    sin(uv.x * 12.0 + iTime * 1.5),
    sin(uv.y * 9.0  + iTime * 1.2)
  ) * 0.015;

  // Deeper water (further below the level) reads darker.
  float depth = (waterLevel - h) / waterLevel;

  vec3 shallow = vec3(0.20, 0.55, 0.70);
  vec3 deep    = vec3(0.02, 0.18, 0.42);
  vec3 col = mix(shallow, deep, depth);

  // Glints on wave crests.
  float hi = smoothstep(0.6, 1.0, wave.x + wave.y + 1.0);
  col += hi * 0.15;

  gl_FragColor = vec4(col + wave.x * 0.05, 0.85);
}
