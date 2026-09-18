const u=`
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  varying vec2 v_texCoord;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`,d=`
  precision highp float;
  uniform sampler2D u_texture;
  uniform vec2 u_resolution;
  uniform float u_offset;
  varying vec2 v_texCoord;

  void main() {
    highp vec2 texelSize = 1.0 / u_resolution;
    highp vec4 color = vec4(0.0);

    color += texture2D(u_texture, v_texCoord + vec2(-u_offset, -u_offset) * texelSize);
    color += texture2D(u_texture, v_texCoord + vec2(u_offset, -u_offset) * texelSize);
    color += texture2D(u_texture, v_texCoord + vec2(-u_offset, u_offset) * texelSize);
    color += texture2D(u_texture, v_texCoord + vec2(u_offset, u_offset) * texelSize);

    gl_FragColor = color * 0.25;
  }
`,g=`
  precision highp float;
  uniform sampler2D u_texture1;
  uniform sampler2D u_texture2;
  uniform float u_blend;
  varying vec2 v_texCoord;

  void main() {
    vec4 color1 = texture2D(u_texture1, v_texCoord);
    vec4 color2 = texture2D(u_texture2, v_texCoord);
    gl_FragColor = mix(color1, color2, u_blend);
  }
`,_=`
  precision highp float;
  uniform sampler2D u_texture;
  uniform vec3 u_tintColor;
  uniform float u_tintIntensity;
  varying vec2 v_texCoord;

  void main() {
    vec4 color = texture2D(u_texture, v_texCoord);
    float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));

    // darkMask: 1.0 for black, 0.0 for luma >= 0.5
    float darkMask = 1.0 - smoothstep(0.0, 0.5, luma);

    // Blend dark areas toward tint color
    color.rgb = mix(color.rgb, u_tintColor, darkMask * u_tintIntensity);

    gl_FragColor = color;
  }
`,x=`
  precision highp float;
  uniform sampler2D u_texture;
  uniform float u_time;
  uniform float u_intensity;
  varying vec2 v_texCoord;

  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                        -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  void main() {
    vec2 uv = v_texCoord;
    float t = u_time * 0.05;

    vec2 center = uv - 0.5;
    float centerWeight = 1.0 - smoothstep(0.0, 0.7, length(center));

    // Large-scale movement (slow, big blobs)
    float n1 = snoise(uv * 0.35 + vec2(t, t * 0.7));
    float n2 = snoise(uv * 0.35 + vec2(-t * 0.8, t * 0.5) + vec2(50.0, 50.0));

    // Medium-scale detail (adds organic movement)
    float n3 = snoise(uv * 0.9 + vec2(t * 1.2, -t) + vec2(100.0, 0.0));
    float n4 = snoise(uv * 0.9 + vec2(-t, t * 1.1) + vec2(0.0, 100.0));

    // Combine two octaves
    vec2 warp = vec2(
      n1 * 0.65 + n3 * 0.35,
      n2 * 0.65 + n4 * 0.35
    ) * centerWeight;

    vec2 warpedUV = uv + warp * u_intensity;
    warpedUV = clamp(warpedUV, 0.0, 1.0);

    gl_FragColor = texture2D(u_texture, warpedUV);
  }
`,b=`
  precision highp float;
  uniform sampler2D u_texture;
  uniform float u_saturation;
  uniform float u_dithering;
  uniform float u_time;
  uniform float u_scale;
  uniform vec2 u_resolution;
  varying vec2 v_texCoord;

  highp float hash(highp vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    vec2 uv = (v_texCoord - 0.5) / u_scale + 0.5;
    uv = clamp(uv, 0.0, 1.0);

    vec4 color = texture2D(u_texture, uv);

    vec2 center = v_texCoord - 0.5;
    float vignette = 1.0 - dot(center, center) * 0.3;
    color.rgb *= vignette;

    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = mix(vec3(gray), color.rgb, u_saturation);

    highp vec2 pixelPos = floor(v_texCoord * u_resolution);
    highp float noise = hash(vec3(pixelPos, floor(u_time * 60.0)));
    color.rgb += (noise - 0.5) * u_dithering;

    gl_FragColor = color;
  }
`;class E{canvas;gl;halfFloatExt=null;halfFloatLinearExt=null;blurProgram;blendProgram;tintProgram;warpProgram;outputProgram;positionBuffer;texCoordBuffer;sourceTexture;blurFBO1;blurFBO2;currentAlbumFBO;nextAlbumFBO;warpFBO;animationId=null;lastFrameTime=0;accumulatedTime=0;isPlaying=!1;disposed=!1;isTransitioning=!1;transitionStartTime=0;_transitionDuration;_warpIntensity;_blurPasses;_animationSpeed;_targetAnimationSpeed;_saturation;_tintColor;_tintIntensity;_dithering;_scale;hasImage=!1;attribs;uniforms;constructor(t,r={}){this.canvas=t;const e=t.getContext("webgl",{alpha:!0,antialias:!1,depth:!1,stencil:!1,preserveDrawingBuffer:!0,powerPreference:"high-performance"});if(!e)throw new Error("WebGL not supported");this.gl=e,this.halfFloatExt=e.getExtension("OES_texture_half_float"),this.halfFloatLinearExt=e.getExtension("OES_texture_half_float_linear"),this._warpIntensity=r.warpIntensity??1,this._blurPasses=r.blurPasses??8,this._animationSpeed=r.animationSpeed??1,this._targetAnimationSpeed=this._animationSpeed,this._transitionDuration=r.transitionDuration??1e3,this._saturation=r.saturation??1.5,this._tintColor=r.tintColor??[.157,.157,.235],this._tintIntensity=r.tintIntensity??.15,this._dithering=r.dithering??.008,this._scale=r.scale??1,this.blurProgram=this.createProgram(u,d),this.blendProgram=this.createProgram(u,g),this.tintProgram=this.createProgram(u,_),this.warpProgram=this.createProgram(u,x),this.outputProgram=this.createProgram(u,b),this.attribs={position:e.getAttribLocation(this.blurProgram,"a_position"),texCoord:e.getAttribLocation(this.blurProgram,"a_texCoord")},this.uniforms={blur:{resolution:e.getUniformLocation(this.blurProgram,"u_resolution"),texture:e.getUniformLocation(this.blurProgram,"u_texture"),offset:e.getUniformLocation(this.blurProgram,"u_offset")},blend:{texture1:e.getUniformLocation(this.blendProgram,"u_texture1"),texture2:e.getUniformLocation(this.blendProgram,"u_texture2"),blend:e.getUniformLocation(this.blendProgram,"u_blend")},warp:{texture:e.getUniformLocation(this.warpProgram,"u_texture"),time:e.getUniformLocation(this.warpProgram,"u_time"),intensity:e.getUniformLocation(this.warpProgram,"u_intensity")},tint:{texture:e.getUniformLocation(this.tintProgram,"u_texture"),tintColor:e.getUniformLocation(this.tintProgram,"u_tintColor"),tintIntensity:e.getUniformLocation(this.tintProgram,"u_tintIntensity")},output:{texture:e.getUniformLocation(this.outputProgram,"u_texture"),saturation:e.getUniformLocation(this.outputProgram,"u_saturation"),dithering:e.getUniformLocation(this.outputProgram,"u_dithering"),time:e.getUniformLocation(this.outputProgram,"u_time"),scale:e.getUniformLocation(this.outputProgram,"u_scale"),resolution:e.getUniformLocation(this.outputProgram,"u_resolution")}},this.positionBuffer=this.createBuffer(new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1])),this.texCoordBuffer=this.createBuffer(new Float32Array([0,0,1,0,0,1,0,1,1,0,1,1])),this.sourceTexture=this.createTexture(),this.blurFBO1=this.createFramebuffer(128,128,!0),this.blurFBO2=this.createFramebuffer(128,128,!0),this.currentAlbumFBO=this.createFramebuffer(128,128,!0),this.nextAlbumFBO=this.createFramebuffer(128,128,!0);const i=Math.max(1,t.width||640),a=Math.max(1,t.height||360);this.warpFBO=this.createFramebuffer(i,a,!0)}get warpIntensity(){return this._warpIntensity}set warpIntensity(t){this._warpIntensity=Math.max(0,Math.min(1,t))}get blurPasses(){return this._blurPasses}set blurPasses(t){const r=Math.max(1,Math.min(40,Math.floor(t)));r!==this._blurPasses&&(this._blurPasses=r,this.hasImage&&this.reblurCurrentImage())}get animationSpeed(){return this._targetAnimationSpeed}set animationSpeed(t){this._targetAnimationSpeed=Math.max(.1,Math.min(5,t))}get transitionDuration(){return this._transitionDuration}set transitionDuration(t){this._transitionDuration=Math.max(0,Math.min(5e3,t))}get saturation(){return this._saturation}set saturation(t){this._saturation=Math.max(0,Math.min(3,t))}get tintColor(){return this._tintColor}set tintColor(t){const r=t.map(i=>Math.max(0,Math.min(1,i)));r.some((i,a)=>i!==this._tintColor[a])&&(this._tintColor=r,this.hasImage&&this.reblurCurrentImage())}get tintIntensity(){return this._tintIntensity}set tintIntensity(t){const r=Math.max(0,Math.min(1,t));r!==this._tintIntensity&&(this._tintIntensity=r,this.hasImage&&this.reblurCurrentImage())}get dithering(){return this._dithering}set dithering(t){this._dithering=Math.max(0,Math.min(.1,t))}get scale(){return this._scale}set scale(t){this._scale=Math.max(.01,Math.min(4,t))}setOptions(t){t.warpIntensity!==void 0&&(this.warpIntensity=t.warpIntensity),t.blurPasses!==void 0&&(this.blurPasses=t.blurPasses),t.animationSpeed!==void 0&&(this.animationSpeed=t.animationSpeed),t.transitionDuration!==void 0&&(this.transitionDuration=t.transitionDuration),t.saturation!==void 0&&(this.saturation=t.saturation),t.tintColor!==void 0&&(this.tintColor=t.tintColor),t.tintIntensity!==void 0&&(this.tintIntensity=t.tintIntensity),t.dithering!==void 0&&(this.dithering=t.dithering),t.scale!==void 0&&(this.scale=t.scale)}getOptions(){return{warpIntensity:this._warpIntensity,blurPasses:this._blurPasses,animationSpeed:this._targetAnimationSpeed,transitionDuration:this._transitionDuration,saturation:this._saturation,tintColor:this._tintColor,tintIntensity:this._tintIntensity,dithering:this._dithering,scale:this._scale}}async loadImage(t){if(!t)return;let r=null;try{const i=await fetch(t,{mode:"cors"});if(i.ok){const a=await i.blob();r=await createImageBitmap(a)}}catch{}if(r||(r=await new Promise((i,a)=>{const o=new Image;o.crossOrigin="anonymous",o.onload=()=>i(o),o.onerror=()=>a(new Error(`Failed to load image: ${t}`)),o.src=t})),this.disposed)return;const e=this.gl;e.bindTexture(e.TEXTURE_2D,this.sourceTexture),e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,0),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,e.RGBA,e.UNSIGNED_BYTE,r),"close"in r&&typeof r.close=="function"&&r.close(),this.processNewImage()}loadImageElement(t){this.gl.bindTexture(this.gl.TEXTURE_2D,this.sourceTexture),this.gl.texImage2D(this.gl.TEXTURE_2D,0,this.gl.RGBA,this.gl.RGBA,this.gl.UNSIGNED_BYTE,t),this.processNewImage()}loadImageData(t,r,e){this.gl.bindTexture(this.gl.TEXTURE_2D,this.sourceTexture),this.gl.texImage2D(this.gl.TEXTURE_2D,0,this.gl.RGBA,r,e,0,this.gl.RGBA,this.gl.UNSIGNED_BYTE,t instanceof Uint8ClampedArray?new Uint8Array(t.buffer):t),this.processNewImage()}loadFromImageData(t){this.loadImageData(t.data,t.width,t.height)}async loadBlob(t){const r=await createImageBitmap(t);if(this.disposed){r.close();return}this.loadImageElement(r),r.close()}loadBase64(t){const r=t.startsWith("data:")?t:`data:image/png;base64,${t}`;return this.loadImage(r)}async loadArrayBuffer(t,r="image/png"){const e=new Blob([t],{type:r});return this.loadBlob(e)}loadGradient(t,r=135){const i=document.createElement("canvas");i.width=512,i.height=512;const a=i.getContext("2d");if(!a)return;const o=r*Math.PI/180,s=512/2-Math.cos(o)*512,n=512/2-Math.sin(o)*512,l=512/2+Math.cos(o)*512,m=512/2+Math.sin(o)*512,h=a.createLinearGradient(s,n,l,m);t.forEach((f,c)=>{h.addColorStop(c/(t.length-1),f)}),a.fillStyle=h,a.fillRect(0,0,512,512),this.loadImageElement(i)}processNewImage(){if(!this.hasImage){this.blurSourceInto(this.nextAlbumFBO),this.blurSourceInto(this.currentAlbumFBO),this.hasImage=!0,this.isTransitioning=!1;return}const t=this.currentAlbumFBO;this.currentAlbumFBO=this.nextAlbumFBO,this.nextAlbumFBO=t,this.blurSourceInto(this.nextAlbumFBO),this.isTransitioning=!0,this.transitionStartTime=performance.now()}reblurCurrentImage(){this.blurSourceInto(this.nextAlbumFBO)}blurSourceInto(t){const r=this.gl;r.useProgram(this.tintProgram),this.setupAttributes(),r.bindFramebuffer(r.FRAMEBUFFER,this.blurFBO1.framebuffer),r.viewport(0,0,128,128),r.activeTexture(r.TEXTURE0),r.bindTexture(r.TEXTURE_2D,this.sourceTexture),r.uniform1i(this.uniforms.tint.texture,0),r.uniform3fv(this.uniforms.tint.tintColor,this._tintColor),r.uniform1f(this.uniforms.tint.tintIntensity,this._tintIntensity),r.drawArrays(r.TRIANGLES,0,6),r.useProgram(this.blurProgram),this.setupAttributes(),r.uniform2f(this.uniforms.blur.resolution,128,128),r.uniform1i(this.uniforms.blur.texture,0);let e=this.blurFBO1,i=this.blurFBO2;for(let a=0;a<this._blurPasses;a++){r.bindFramebuffer(r.FRAMEBUFFER,i.framebuffer),r.viewport(0,0,128,128),r.bindTexture(r.TEXTURE_2D,e.texture),r.uniform1f(this.uniforms.blur.offset,a+.5),r.drawArrays(r.TRIANGLES,0,6);const o=e;e=i,i=o}r.bindFramebuffer(r.FRAMEBUFFER,t.framebuffer),r.viewport(0,0,128,128),r.bindTexture(r.TEXTURE_2D,e.texture),r.uniform1f(this.uniforms.blur.offset,0),r.drawArrays(r.TRIANGLES,0,6)}resize(){const t=Math.max(1,this.canvas.width),r=Math.max(1,this.canvas.height);(this.warpFBO.width!==t||this.warpFBO.height!==r)&&(this.warpFBO&&this.deleteFramebuffer(this.warpFBO),this.warpFBO=this.createFramebuffer(t,r,!0))}start(){this.disposed||this.isPlaying||(this.isPlaying=!0,this.lastFrameTime=performance.now(),this.animationId=requestAnimationFrame(this.renderLoop))}stop(){this.isPlaying=!1,this.animationId!==null&&(cancelAnimationFrame(this.animationId),this.animationId=null)}renderFrame(t){const r=performance.now();if(t!==void 0)this.render(t,r);else{const e=(r-this.lastFrameTime)/1e3;this.lastFrameTime=r,this._animationSpeed+=(this._targetAnimationSpeed-this._animationSpeed)*.05,this.accumulatedTime+=e*this._animationSpeed,this.render(this.accumulatedTime,r)}}dispose(){if(this.disposed)return;this.disposed=!0,this.stop();const t=this.gl;t.deleteProgram(this.blurProgram),t.deleteProgram(this.blendProgram),t.deleteProgram(this.tintProgram),t.deleteProgram(this.warpProgram),t.deleteProgram(this.outputProgram),t.deleteBuffer(this.positionBuffer),t.deleteBuffer(this.texCoordBuffer),t.deleteTexture(this.sourceTexture),this.deleteFramebuffer(this.blurFBO1),this.deleteFramebuffer(this.blurFBO2),this.deleteFramebuffer(this.currentAlbumFBO),this.deleteFramebuffer(this.nextAlbumFBO),this.deleteFramebuffer(this.warpFBO)}renderLoop=t=>{if(!this.isPlaying)return;const r=(t-this.lastFrameTime)/1e3;this.lastFrameTime=t,this._animationSpeed+=(this._targetAnimationSpeed-this._animationSpeed)*.05,this.accumulatedTime+=r*this._animationSpeed,this.render(this.accumulatedTime,t),this.animationId=requestAnimationFrame(this.renderLoop)};render(t,r=performance.now()){if(this.disposed||!this.hasImage)return;const e=this.gl,i=Math.max(1,this.canvas.width),a=Math.max(1,this.canvas.height);(this.warpFBO.width!==i||this.warpFBO.height!==a)&&(this.deleteFramebuffer(this.warpFBO),this.warpFBO=this.createFramebuffer(i,a,!0));let o=1;if(this.isTransitioning){const n=r-this.transitionStartTime;o=Math.min(1,n/this._transitionDuration),o>=1&&(this.isTransitioning=!1)}let s;if(this.isTransitioning&&o<1){e.useProgram(this.blendProgram),this.setupAttributes(),e.bindFramebuffer(e.FRAMEBUFFER,this.blurFBO1.framebuffer),e.viewport(0,0,128,128),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,this.currentAlbumFBO.texture),e.uniform1i(this.uniforms.blend.texture1,0),e.activeTexture(e.TEXTURE1),e.bindTexture(e.TEXTURE_2D,this.nextAlbumFBO.texture),e.uniform1i(this.uniforms.blend.texture2,1);const n=.5-.5*Math.cos(o*Math.PI);e.uniform1f(this.uniforms.blend.blend,n),e.drawArrays(e.TRIANGLES,0,6),s=this.blurFBO1.texture}else s=this.nextAlbumFBO.texture;e.useProgram(this.warpProgram),this.setupAttributes(),e.bindFramebuffer(e.FRAMEBUFFER,this.warpFBO.framebuffer),e.viewport(0,0,i,a),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,s),e.uniform1i(this.uniforms.warp.texture,0),e.uniform1f(this.uniforms.warp.time,t),e.uniform1f(this.uniforms.warp.intensity,this._warpIntensity),e.drawArrays(e.TRIANGLES,0,6),e.useProgram(this.outputProgram),this.setupAttributes(),e.bindFramebuffer(e.FRAMEBUFFER,null),e.viewport(0,0,i,a),e.bindTexture(e.TEXTURE_2D,this.warpFBO.texture),e.uniform1i(this.uniforms.output.texture,0),e.uniform1f(this.uniforms.output.saturation,this._saturation),e.uniform1f(this.uniforms.output.dithering,this._dithering),e.uniform1f(this.uniforms.output.time,t),e.uniform1f(this.uniforms.output.scale,this._scale),e.uniform2f(this.uniforms.output.resolution,i,a),e.drawArrays(e.TRIANGLES,0,6)}setupAttributes(){const t=this.gl;t.bindBuffer(t.ARRAY_BUFFER,this.positionBuffer),t.enableVertexAttribArray(this.attribs.position),t.vertexAttribPointer(this.attribs.position,2,t.FLOAT,!1,0,0),t.bindBuffer(t.ARRAY_BUFFER,this.texCoordBuffer),t.enableVertexAttribArray(this.attribs.texCoord),t.vertexAttribPointer(this.attribs.texCoord,2,t.FLOAT,!1,0,0)}createShader(t,r){const e=this.gl,i=e.createShader(t);if(!i)throw new Error("Failed to create shader");if(e.shaderSource(i,r),e.compileShader(i),!e.getShaderParameter(i,e.COMPILE_STATUS)){const a=e.getShaderInfoLog(i);throw e.deleteShader(i),new Error(`Shader compile error: ${a}`)}return i}createProgram(t,r){const e=this.gl,i=this.createShader(e.VERTEX_SHADER,t),a=this.createShader(e.FRAGMENT_SHADER,r),o=e.createProgram();if(!o)throw new Error("Failed to create program");if(e.attachShader(o,i),e.attachShader(o,a),e.linkProgram(o),!e.getProgramParameter(o,e.LINK_STATUS)){const s=e.getProgramInfoLog(o);throw e.deleteProgram(o),new Error(`Program link error: ${s}`)}return e.deleteShader(i),e.deleteShader(a),o}createBuffer(t){const r=this.gl,e=r.createBuffer();if(!e)throw new Error("Failed to create buffer");return r.bindBuffer(r.ARRAY_BUFFER,e),r.bufferData(r.ARRAY_BUFFER,t,r.STATIC_DRAW),e}createTexture(){const t=this.gl,r=t.createTexture();if(!r)throw new Error("Failed to create texture");return t.bindTexture(t.TEXTURE_2D,r),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.LINEAR),r}createFramebuffer(t,r,e=!1){const i=this.gl,a=this.createTexture(),s=e&&this.halfFloatExt&&this.halfFloatLinearExt?this.halfFloatExt.HALF_FLOAT_OES:i.UNSIGNED_BYTE;i.texImage2D(i.TEXTURE_2D,0,i.RGBA,t,r,0,i.RGBA,s,null);const n=i.createFramebuffer();if(!n)throw new Error("Failed to create framebuffer");return i.bindFramebuffer(i.FRAMEBUFFER,n),i.framebufferTexture2D(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,a,0),{framebuffer:n,texture:a,width:t,height:r}}deleteFramebuffer(t){this.gl.deleteFramebuffer(t.framebuffer),this.gl.deleteTexture(t.texture)}}export{E as Kawarp,E as default};
