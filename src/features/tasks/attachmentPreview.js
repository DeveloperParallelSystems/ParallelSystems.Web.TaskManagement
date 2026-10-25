import { request } from '../../app/api.js';

const previewFormats = [
    { type: 'application/pdf', extension: /\.pdf$/i },
    { type: 'image/png', extension: /\.png$/i },
    { type: 'image/jpeg', extension: /\.jpe?g$/i },
];

function mediaType(value = '') {
    if (typeof value !== 'string') {
        return '';
    }
    return value.split(';')[0].trim().toLowerCase();
}

export function attachmentPreviewType(attachment) {
    return previewFormats.find((format) => format.type === mediaType(attachment.contentType) &&
        format.extension.test(attachment.fileName))?.type || null;
}

export async function loadAttachmentPreview(taskId, attachment, signal, requestFile = request, urls = URL) {
    const type = attachmentPreviewType(attachment);
    if (!type) {
        throw new Error('Preview is available for PDF, PNG and JPEG files. Download this file to open it.');
    }
    signal.throwIfAborted();
    const blob = await requestFile(`/tasks/${taskId}/attachments/${attachment.id}/content`, {
        responseType: 'blob', signal,
    });
    signal.throwIfAborted();
    if (mediaType(blob.type) !== type) {
        throw new Error('The file response could not be previewed. Try downloading the file instead.');
    }
    return { url: urls.createObjectURL(blob), type };
}
