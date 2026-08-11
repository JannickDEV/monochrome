package tf.monochrome.music;

import android.content.ContentValues;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;

import com.getcapacitor.BridgeActivity;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "Monochrome";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundAudioPlugin.class);
        super.onCreate(savedInstanceState);
        getBridge().getWebView().addJavascriptInterface(new AndroidDownloadBridge(), "AndroidDownload");
    }

    /**
     * JS bridge for saving downloaded files. The web app calls
     * AndroidDownload.saveDownload(base64, filename, mimeType) when the
     * WebView's anchor-based blob downloads would otherwise do nothing.
     */
    private class AndroidDownloadBridge {
        @JavascriptInterface
        public void saveDownload(String base64Data, String filename, String mimeType) {
            final byte[] data = Base64.decode(base64Data, Base64.DEFAULT);
            final String safeName = sanitizeFilename(filename);
            final String mime = (mimeType == null || mimeType.isEmpty()) ? "application/octet-stream" : mimeType;
            new Thread(() -> save(data, safeName, mime)).start();
        }

        private void save(byte[] data, String filename, String mimeType) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    saveToMediaStore(data, filename, mimeType);
                } else {
                    saveToLegacyStorage(data, filename, mimeType);
                }
            } catch (Exception e) {
                Log.e(TAG, "Download save failed", e);
            }
        }

        private void saveToMediaStore(byte[] data, String filename, String mimeType) throws Exception {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, filename);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                Log.e(TAG, "MediaStore insert returned null");
                return;
            }
            try {
                try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                    out.write(data);
                }
            } finally {
                values.clear();
                values.put(MediaStore.MediaColumns.IS_PENDING, 0);
                getContentResolver().update(uri, values, null, null);
            }
        }

        private void saveToLegacyStorage(byte[] data, String filename, String mimeType) throws Exception {
            File downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            if (!downloads.exists() && !downloads.mkdirs()) {
                Log.e(TAG, "Could not create Downloads directory");
                return;
            }
            File file = uniqueFile(downloads, filename);
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(data);
            }
            MediaScannerConnection.scanFile(getApplicationContext(),
                    new String[] { file.getAbsolutePath() },
                    new String[] { mimeType },
                    null);
        }

        private File uniqueFile(File dir, String filename) {
            File file = new File(dir, filename);
            if (!file.exists()) {
                return file;
            }
            String base = filename;
            String ext = "";
            int dot = filename.lastIndexOf('.');
            if (dot > 0) {
                base = filename.substring(0, dot);
                ext = filename.substring(dot);
            }
            int i = 1;
            while (file.exists()) {
                file = new File(dir, base + " (" + i + ")" + ext);
                i++;
            }
            return file;
        }

        private String sanitizeFilename(String filename) {
            String name = filename == null ? "download" : filename;
            name = name.replaceAll("[/\\\\:*?\"<>|]", "_").trim();
            return name.isEmpty() ? "download" : name;
        }
    }
}
