export const maxAttachmentBytes = 10 * 1024 * 1024;
export const attachmentAccept = '.pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,.ppt,.pptx';

export function attachmentError(file) {
    if (!file || file.size <= 0) {
        return 'Choose a non-empty file.';
    }
    if (file.size > maxAttachmentBytes) {
        return 'The maximum file size is 10 MB.';
    }
    if (!/\.(pdf|png|jpe?g|docx?|xlsx?|pptx?)$/i.test(file.name)) {
        return 'Choose a PDF, PNG, JPEG, Word, Excel or PowerPoint file.';
    }
    if (file.name.length > 255 || /[\x00-\x1f\x7f]/.test(file.name)) {
        return 'Use a filename of up to 255 characters without control characters.';
    }
    return null;
}

export function attachmentSize(bytes) {
    if (bytes < 1024 * 1024) {
        return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
