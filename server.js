const express = require("express");
const fileUpload = require('express-fileupload');
const Firestore = require('@google-cloud/firestore');
const Promise = require("bluebird");
const { Storage } = require('@google-cloud/storage');
const storage = new Storage();
const im = require('imagemagick');
const vision = require('@google-cloud/vision');

const visionClient = new vision.ImageAnnotatorClient();

const pictureStore = new Firestore({ ignoreUndefinedProperties: true }).collection(process.env.FIRESTORE_COLLECTION);
const pictureBucket = storage.bucket(process.env.STORAGE_BUCKET);

const app = express();
app.use(fileUpload({
    limits: { fileSize: 10 * 1024 * 1024 },
    useTempFiles : true,
    tempFileDir : '/tmp/'
}))

function x(string, br = false) {
    if (!string) return "";
    const n = string.length;
    let result = "";
    for (let i = 0; i < n; i++) {
        const c = string.charAt(i);
        switch (c) {
            case "&": result += "&amp;"; break;
            case "<": result += "&lt;"; break;
            case ">": result += "&gt;"; break;
            case "'": result += "&apos;"; break;
            case '"': result += "&quot;"; break;
            case "\n": result += br ? "<br>\n" : "\n"; break;
            default: result += c;
        }
    }
    return result;
}

function alertContents(errorMessage) {
    return `<div class="alert alert-danger alert-app-level">
              <div class="alert-items">
                <div class="alert-item static">
                  <div class="alert-icon-wrapper">
                    <clr-icon class="alert-icon" shape="error-standard"></clr-icon>
                  </div>
                  <span class="alert-text">${x(errorMessage)}</span>
                </div>
              </div>
            </div>`;
}

function swapAlert(errorMessage) {
    return `<div id="alert-container" hx-swap-oob="true">${alertContents(errorMessage)}</div>`;
}

function clearAlert() {
    return `<div id="alert-container" hx-swap-oob="true"></div>`;
}

async function showPhotos() {
    console.log('Retrieving list of pictures');

    const snapshot = await pictureStore
        .where('status', '==', 'uploaded')
        .orderBy('created', 'desc').get();

    if (snapshot.empty) {
        console.log('No pictures found');
        return "";
    }

    const docs = snapshot.docs;
    const rows = (docs.length + 3) / 4;
    let result = "";

    for (let row = 0; row < rows; row++) {
        result += `<div class="clr-row">`;
        for (let col = 0; col < 4; col++) {
            const i = row * 4 + col;
            const tooltipClasses = `tooltip tooltip-lg tooltip-${col < 3 ? 'right' : 'left'}`;
            if (i < docs.length) {
                const doc = docs[i];
                const pic = doc.data();
                const prefix = `${doc.id}_${pic.version}`;
                result += `
                    <div class="clr-col-lg-3 clr-col-12">
                      <div class="card">
                        <div class="card-img">
                          <img src="${x('https://storage.googleapis.com/' + process.env.STORAGE_BUCKET + '/' + prefix + '-thumbnail.jpeg')}" />
                        </div>
                        <div class="card-block">
                          <p class="card-text" style="color: ${pic.color}">
                            <b>Operation:</b> ${x(pic.operation)}<br>
                            <b>Text of Interest:</b> ${x(pic.textOfInterest) || "<i>all</i>"}<br>
                            <b>Logo Detection:</b> ${x(pic.logo_Detection)}<br>
                            <b>Face Detection:</b> ${x(pic.faceOperation)}
                          </p>
                        </div>
                        <div class="card-footer">
                          <span class="${tooltipClasses} btn btn-sm btn-link" style="cursor: default; text-transform: none">
                            <clr-icon shape="file"></clr-icon>
                            <span class="tooltip-content">${x(pic.filename)}</span>
                          </span>
                          <span class="${tooltipClasses} btn btn-sm btn-link" style="cursor: default; text-transform: none">
                            <clr-icon shape="tags"></clr-icon>
                            <span class="tooltip-content">${x(pic.labels.join(", "))}</span>
                          </span>
                          <a href="${x('https://storage.googleapis.com/' + process.env.STORAGE_BUCKET + '/' + prefix + '-fullsize.jpeg')}" target=_blank class="btn btn-sm btn-link">
                            <clr-icon shape="pop-out"></clr-icon>
                          </a>
                          <a href="javascript:;" class="btn btn-sm btn-link" hx-get="/managePhotoForm?id=${doc.id}">
                            <clr-icon shape="pencil"></clr-icon>
                          </a>
                          <a href="javascript:;" class="btn btn-sm btn-link" hx-post="/deletePhoto?id=${doc.id}"
                              hx-confirm="Are you sure you want to delete this picture?">
                            <clr-icon shape="trash"></clr-icon>
                          </a>
                        </div>
                      </div>
                    </div>`;
            }
        }
        result += `</div>`;
    }
    return result;
}

function uploadPhotoForm(id = "", pic = {}) {
    return `
        <form class="clr-form-horizontal" hx-post="/uploadPhoto" hx-encoding="multipart/form-data">

          <input type="hidden" name="id" value="${x(id)}" />

          <div class="clr-form-control clr-row">
            <div class="clr-control-container clr-offset-md-2 clr-col-md-10">
              <div class="clr-file-wrapper">
                <label for="picture" class="clr-control-label"><span class="btn btn-sm">browse</span></label>
                <input type="file" name="picture" id="picture" class="clr-file"
                  onchange="document.getElementById('picture-filename').textContent = this.files[0].name; document.getElementById('auto').selected = true" />
                <span id="picture-filename">${x(pic.filename || 'Choose file...')}</span>
              </div>
            </div>
          </div>

          <div class="clr-form-control clr-row">
            <label for="operation" class="clr-control-label clr-col-12 clr-col-md-2">Operation</label>
            <div class="clr-control-container clr-col-12 clr-col-md-10">
              <div class="clr-input-wrapper">
                <select id="operation" name="operation" class="clr-input">
                  <option${pic.operation === "Blur" ? " selected" : ""}>Blur</option>
                  <option${pic.operation === "Focus" ? " selected" : ""}>Focus</option>
                  <option${pic.operation === "Redact" ? " selected" : ""}>Redact</option>
                </select>
              </div>
            </div>
          </div>

          <div class="clr-form-control clr-row">
            <label for="textOfInterest" class="clr-control-label clr-col-12 clr-col-md-2">Text of Interest</label>
            <div class="clr-control-container clr-col-12 clr-col-md-10">
              <div class="clr-input-wrapper">
                <input type="text" id="textOfInterest" name="textOfInterest" placeholder="(* or empty for all)" value="${x(pic.textOfInterest)}" class="clr-input" />
              </div>
            </div>
          </div>

          <div class="clr-form-control clr-row">  
            <label for="logo_Detection" class="clr-control-label clr-col-12 clr-col-md-2">Logo Detection</label>
            <div class="clr-control-container clr-col-12 clr-col-md-10">
              <div class="clr-input-wrapper">
                <select id="logo_Detection" name="logo_Detection" class="clr-input">
                  <option${pic.logo_Detection === "Yes" ? " selected" : ""}>Yes</option>
                  <option${pic.logo_Detection === "No" ? " selected" : ""}>No</option>
                </select>
              </div>
            </div>
          </div>

          <div class="clr-form-control clr-row">
          <label for="faceOperation" class="clr-control-label clr-col-12 clr-col-md-2">Face Detection</label>
          <div class="clr-control-container clr-col-12 clr-col-md-10">
            <div class="clr-input-wrapper">
              <select id="faceOperation" name="faceOperation" class="clr-input">
                <option${pic.faceOperation === "All" ? " selected" : ""}>All</option>
                <option${pic.faceOperation === "Happy" ? " selected" : ""}>Happy</option>
                <option${pic.faceOperation === "Sad" ? " selected" : ""}>Sad</option>
                <option${pic.faceOperation === "Angry" ? " selected" : ""}>Angry</option>
                <option${pic.faceOperation === "Surprised" ? " selected" : ""}>Surprised</option>
                <option${pic.faceOperation === "None" ? " selected" : ""}>None</option>
              </select>
            </div>
          </div>
        </div>

          <div class="clr-form-control clr-row">
            <div class="clr-control-container clr-offset-md-2 clr-col-md-10">
              <button class="btn btn-sm" type="submit">Upload</button>
            </div>
          </div>

        </form>`;
}

function headerNav(tab, oob) {
    return `
        <div id="header-nav-oob" class="header-nav"${oob ? " hx-swap-oob=true" : ""}>
            <a href="javascript:;" hx-get="/showPhotos"
                class="${tab === "showPhotos" ? "active " : ""}nav-link nav-text">Show Photos</a>
            <a href="javascript:;" hx-get="/uploadPhotoForm"
                class="${tab === "uploadPhotoForm" ? "active " : ""}nav-link nav-text">Upload Photo</a>
            <a href="javascript:;" style="cursor: default"
                class="${tab === "managePhotoForm" ? "active " : ""}nav-link nav-text">Manage Photo</a>
        </div>`;
}

app.get("/", async (req, res) => {
    let showPhotosHtml, alertHtml;
    try {
        showPhotosHtml = await showPhotos();
        alertHtml = "";
    } catch (error) {
        showPhotosHtml = "";
        alertHtml = alertContents(error.message);
    }
    res.send(`<!doctype html>
        <html>
            <head>
                <title>CSC 847 Project 3 (Team 2)</title>
                <link rel="stylesheet" href="https://unpkg.com/@clr/ui/clr-ui-dark.min.css" />
                <link rel="stylesheet" href="https://unpkg.com/@clr/icons/clr-icons.min.css">
                <script src="https://unpkg.com/@webcomponents/custom-elements/custom-elements.min.js"></script>
                <script src="https://unpkg.com/@clr/icons/clr-icons.min.js"></script>
                <script src="https://unpkg.com/htmx.org@0.2.0"></script>
            </head>
            <body hx-target="#target">
                <div class="main-container">
                    <div id="alert-container">${alertHtml}</div>
                    <header class="header header-6">
                        <div class="branding">
                            <span class="title">CSC 847 Project 3 (Team 2)</span>
                        </div>
                        ${headerNav("showPhotos", false)}
                    </header>
                    <div class="content-container">
                        <div id="content-oob" class="content-area">${showPhotosHtml}</div>
                    </div>
                </div>
                <div id="target"></div>
            </body>
        </html>`);
});

function swapContent(contentHtml) {
    return `<div id="content-oob" class="content-area" hx-swap-oob="true">${contentHtml}</div>`;
}

app.get("/showPhotos", async (req, res) => {
    try {
        const showPhotosHtml = await showPhotos();
        res.send(clearAlert() + headerNav("showPhotos", true) + swapContent(showPhotosHtml));
    } catch (error) {
        res.send(swapAlert(error.message));
    }
});

app.get("/uploadPhotoForm", (req, res) => {
    try {
        res.send(clearAlert() + headerNav("uploadPhotoForm", true) + swapContent(uploadPhotoForm()));
    } catch (error) {
        res.send(swapAlert(error.message));
    }
});

app.get("/managePhotoForm", async (req, res) => {
    try {
        const id = req.query.id;
        const doc = await pictureStore.doc(id).get();
        res.send(clearAlert() + headerNav("managePhotoForm", true) + swapContent(uploadPhotoForm(id, doc.data())));
    } catch (error) {
        res.send(swapAlert(error.message));
    }
});

app.post("/deletePhoto", async (req, res) => {
    try {
        const id = req.query.id;
        await pictureStore.doc(id).delete();
        const showPhotosHtml = await showPhotos();
        res.send(clearAlert() + headerNav("showPhotos", true) + swapContent(showPhotosHtml));
    } catch (error) {
        res.send(swapAlert(error.message));
    }
});

app.post('/uploadPhoto', async (req, res) => {
    try {
        let id = req.body.id;
        let v;
        let existingData;

        const hasFile = req.files && req.files.picture;
        if (!id && !hasFile) {
            console.log("No file uploaded");
            return res.send(swapAlert("No file was uploaded."));
        }

        if (id) {
            await pictureStore.doc(id).update({
                operation: req.body.operation || "Blur",
                textOfInterest: req.body.textOfInterest || '*',
                logo_Detection: req.body.logo_Detection || "Yes",
                faceOperation: req.body.faceOperation || "All"
            });
            existingData = (await pictureStore.doc(id).get()).data();
            v = existingData.version;
        } else {
            const newDoc = await pictureStore.add({
                status: "uploading",
                created: Firestore.Timestamp.now(),
                operation: req.body.operation || "Blur",
                textOfInterest: req.body.textOfInterest || '*',
                logo_Detection: req.body.logo_Detection || "Yes",
                faceOperation: req.body.faceOperation || "All"
            });
            id = newDoc.id;
            v = 0;
        }

        let filename;
        let tempFile;

        if (hasFile) {
            console.log(`Receiving file ${JSON.stringify(req.files.picture)}`);
            const picture = req.files.picture;

            filename = picture.name;
            tempFile = picture.tempFilePath;
        } else {
            // The v here is intentionally _before_ incrementing it
            const objectName = `${id}_${v}-original.jpeg`;
            console.log(`Reusing previously uploaded file ${objectName}`);

            filename = existingData.filename;
            tempFile = `/tmp/${objectName}`;

            await pictureBucket.file(objectName).download({destination: tempFile})
        }

        v++;

        const fullsizeFile = `/tmp/${id}_${v}-fullsize.jpeg`;
        const thumbnailFile = `/tmp/${id}_${v}-thumbnail.jpeg`;

        const identify = Promise.promisify(im.identify);
        const {format, width, height} = await identify(tempFile);

        if (format !== "JPEG") {
            return res.send(swapAlert(`Unrecognized file format: ${format}`));
        }

        const originalPromise = pictureBucket.upload(tempFile, { destination: `${id}_${v}-original.jpeg`,
            metadata: { contentType: "image/jpeg" }, resumable: false });

        const [visionResponse] = await visionClient.annotateImage({
            image: { source: { filename: tempFile } },
            features: [
                { type: 'LABEL_DETECTION' },
                { type: 'IMAGE_PROPERTIES' },
                { type: 'FACE_DETECTION'},
                { type: 'LOGO_DETECTION'},
                { type: 'TEXT_DETECTION' }
            ]
        });

        if (visionResponse.error) {
            throw new Error(`Vision API error: code ${visionResponse.error.code}, message: "${visionResponse.error.message}"`);
        }
        const labels = visionResponse.labelAnnotations
                .sort((ann1, ann2) => ann2.score - ann1.score)
                .map(ann => ann.description)
        const color = visionResponse.imagePropertiesAnnotation.dominantColors.colors
                .sort((c1, c2) => c2.score - c1.score)[0].color;
        const colorHex = decColorToHex(color.red, color.green, color.blue);
        const faces = visionResponse.faceAnnotations;
        const logos = visionResponse.logoAnnotations;
        const texts = visionResponse.textAnnotations
        const polygons = [];

        if(faces && req.body.faceOperation === 'All'){
          faces.forEach(face => {  
              polygons.push(face.boundingPoly.vertices) 
        });
      }
        
        else if(faces && req.body.faceOperation === 'Happy'){
          faces.forEach(face => {  
            if(face.joyLikelihood === "VERY_LIKELY"){
              polygons.push(face.boundingPoly.vertices) 
            }
        });
      }

        else if(faces && req.body.faceOperation === 'Sad'){
          faces.forEach(face => {  
            if(face.sorrowLikelihood === "VERY_LIKELY"){
              polygons.push(face.boundingPoly.vertices) 
            }
        });
      }

        else if(faces && req.body.faceOperation === 'Angry'){
          faces.forEach(face => {  
            if(face.angerLikelihood === "VERY_LIKELY"){
              polygons.push(face.boundingPoly.vertices) 
            }
        });
      }

        else if(faces && req.body.faceOperation === 'Surprised'){
          faces.forEach(face => {  
            if(face.surpriseLikelihood === "VERY_LIKELY"){
              polygons.push(face.boundingPoly.vertices) 
            }
        });
      }
      
        if(logos && req.body.logo_Detection === "Yes"){
          logos.forEach(logo => {  
              polygons.push(logo.boundingPoly.vertices) 
          });
        }

        if (!req.body.textOfInterest || req.body.textOfInterest === '*' || req.body.textOfInterest === 'all') { 
            if (texts[0]) {
                polygons.push(texts[0].boundingPoly.vertices)
            }
        } else {
            for (let i = 1; i < texts.length; i++) {
                if (
                    texts[i] && texts[i].description &&
                    texts[i].description.toLowerCase().includes(req.body.textOfInterest.toLowerCase())
                ) {
                    polygons.push(texts[i].boundingPoly.vertices)
                }
            }
        }

        const polygonString = polygons.flatMap(polygon => ["polygon", ...polygon.map(
            vertex => `${Math.floor(vertex.x)},${Math.floor(vertex.y)}`)]).join(" ");

        const convert = Promise.promisify(im.convert);

        if (req.body.operation === "Redact") {
            await convert([tempFile, '-fill', 'black', '-draw', polygonString, fullsizeFile]);
        } else if (req.body.operation === "Focus") {
            await convert([tempFile, '(', '-clone', '0', '-fill', 'black', '-colorize', '100', '-fill', 'white',
                '-draw', polygonString, '-alpha', 'off', '-write', 'mpr:mask', '+delete', ')',
                '-mask', 'mpr:mask', '-blur', '0x15', '+mask', fullsizeFile]);
        } else {
            await convert([tempFile, '(', '-clone', '0', '-fill', 'white', '-colorize', '100', '-fill', 'black',
                '-draw', polygonString, '-alpha', 'off', '-write', 'mpr:mask', '+delete', ')',
                '-mask', 'mpr:mask', '-blur', '0x25', '+mask', fullsizeFile]);
        }

        const fullsizePromise = pictureBucket.upload(fullsizeFile, { resumable: false });

        const crop = Promise.promisify(im.crop);
        const thumbnailPromise = crop({
            srcPath: fullsizeFile,
            dstPath: thumbnailFile,
            width: 400,
            height: 400
        }).then(() => pictureBucket.upload(thumbnailFile, { resumable: false }));

        await originalPromise;
        await fullsizePromise;
        await thumbnailPromise;

        await pictureStore.doc(id).update({
            status: "uploaded",
            labels: labels,
            color: colorHex,
            filename: filename,
            version: v,
            visionResponse: visionResponse
        });

        const showPhotosHtml = await showPhotos();
        res.send(clearAlert() + headerNav("showPhotos", true) + swapContent(showPhotosHtml));
    } catch (error) {
        res.send(swapAlert(error.message));
    }
});

function decColorToHex(r, g, b) {
    const max = Math.max(r, g, b);
    return '#' + Number(Math.floor(255 * r / max)).toString(16).padStart(2, '0') +
                 Number(Math.floor(255 * g / max)).toString(16).padStart(2, '0') +
                 Number(Math.floor(255 * b / max)).toString(16).padStart(2, '0');
}

const PORT = process.env.PORT || 8880;
app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}/`);
});
