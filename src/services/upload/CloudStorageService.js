const AWS = require('aws-sdk');
const fs = require('fs').promises;
const path = require('path');
const config = require('../../shared/config/environment');
const logger = require('../../shared/utils/logger');

class CloudStorageService {
    constructor() {
        // Initialize S3 client
        this.s3 = new AWS.S3({
            accessKeyId: config.aws.accessKeyId,
            secretAccessKey: config.aws.secretAccessKey,
            region: config.aws.region
        });

        this.bucketName = config.aws.s3Bucket;
        this.cdnBaseUrl = config.aws.cdnBaseUrl || `https://${this.bucketName}.s3.${config.aws.region}.amazonaws.com`;
    }

    // Upload file to S3
    async uploadFile(filePath, key, contentType = 'image/jpeg') {
        try {
            const fileContent = await fs.readFile(filePath);

            const params = {
                Bucket: this.bucketName,
                Key: key,
                Body: fileContent,
                ContentType: contentType,
                ACL: 'public-read', // Make files publicly accessible
                CacheControl: 'max-age=31536000', // Cache for 1 year
                Metadata: {
                    uploadedAt: new Date().toISOString()
                }
            };

            const result = await this.s3.upload(params).promise();

            logger.info('File uploaded to S3 successfully', {
                key,
                location: result.Location,
                size: fileContent.length
            });

            return {
                key,
                location: result.Location,
                etag: result.ETag,
                bucket: this.bucketName,
                size: fileContent.length,
                cdnUrl: `${this.cdnBaseUrl}/${key}`
            };

        } catch (error) {
            logger.error('Failed to upload file to S3', {
                error: error.message,
                filePath,
                key
            });
            throw new Error(`Failed to upload file to cloud storage: ${error.message}`);
        }
    }

    // Delete file from S3
    async deleteFile(key) {
        try {
            const params = {
                Bucket: this.bucketName,
                Key: key
            };

            await this.s3.deleteObject(params).promise();

            logger.info('File deleted from S3 successfully', { key });
            return true;

        } catch (error) {
            logger.error('Failed to delete file from S3', {
                error: error.message,
                key
            });
            return false;
        }
    }

    // Check if file exists in S3
    async fileExists(key) {
        try {
            const params = {
                Bucket: this.bucketName,
                Key: key
            };

            await this.s3.headObject(params).promise();
            return true;

        } catch (error) {
            if (error.code === 'NotFound') {
                return false;
            }
            logger.error('Failed to check file existence in S3', {
                error: error.message,
                key
            });
            return false;
        }
    }

    // Get file metadata from S3
    async getFileMetadata(key) {
        try {
            const params = {
                Bucket: this.bucketName,
                Key: key
            };

            const result = await this.s3.headObject(params).promise();

            return {
                size: result.ContentLength,
                lastModified: result.LastModified,
                contentType: result.ContentType,
                etag: result.ETag,
                metadata: result.Metadata
            };

        } catch (error) {
            logger.error('Failed to get file metadata from S3', {
                error: error.message,
                key
            });
            return null;
        }
    }

    // Upload multiple files (for avatar sizes)
    async uploadAvatarSizes(processedImages, profileId) {
        try {
            const uploadPromises = Object.entries(processedImages).map(async ([size, image]) => {
                const key = `avatars/${profileId}/${size}_${image.filename}`;
                return this.uploadFile(image.path, key, 'image/jpeg');
            });

            const results = await Promise.all(uploadPromises);

            // Create a mapping of size to upload result
            const uploadResults = {};
            Object.keys(processedImages).forEach((size, index) => {
                uploadResults[size] = results[index];
            });

            return uploadResults;

        } catch (error) {
            logger.error('Failed to upload avatar sizes', {
                error: error.message,
                profileId
            });
            throw error;
        }
    }

    // Delete all avatar sizes for a profile
    async deleteAvatarSizes(profileId) {
        try {
            // List all objects with the avatar prefix for this profile
            const params = {
                Bucket: this.bucketName,
                Prefix: `avatars/${profileId}/`
            };

            const objects = await this.s3.listObjectsV2(params).promise();

            if (objects.Contents && objects.Contents.length > 0) {
                // Delete all objects
                const deleteParams = {
                    Bucket: this.bucketName,
                    Delete: {
                        Objects: objects.Contents.map(obj => ({ Key: obj.Key }))
                    }
                };

                await this.s3.deleteObjects(deleteParams).promise();

                logger.info('Deleted avatar sizes from S3', {
                    profileId,
                    count: objects.Contents.length
                });
            }

            return true;

        } catch (error) {
            logger.error('Failed to delete avatar sizes from S3', {
                error: error.message,
                profileId
            });
            return false;
        }
    }

    // Generate presigned URL for direct upload (if needed)
    async generatePresignedUploadUrl(key, contentType, expiresIn = 3600) {
        try {
            const params = {
                Bucket: this.bucketName,
                Key: key,
                ContentType: contentType,
                Expires: expiresIn
            };

            const url = await this.s3.getSignedUrlPromise('putObject', params);

            return {
                url,
                key,
                expiresIn
            };

        } catch (error) {
            logger.error('Failed to generate presigned upload URL', {
                error: error.message,
                key
            });
            throw new Error(`Failed to generate upload URL: ${error.message}`);
        }
    }

    // Get CDN URL for a file
    getCdnUrl(key) {
        return `${this.cdnBaseUrl}/${key}`;
    }

    // Check S3 connection and bucket access
    async testConnection() {
        try {
            await this.s3.headBucket({ Bucket: this.bucketName }).promise();
            logger.info('S3 connection test successful', { bucket: this.bucketName });
            return true;
        } catch (error) {
            logger.error('S3 connection test failed', {
                error: error.message,
                bucket: this.bucketName
            });
            return false;
        }
    }
}

module.exports = new CloudStorageService();