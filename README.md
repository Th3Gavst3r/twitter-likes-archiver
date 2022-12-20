# twitter-likes-archiver

Downloads liked tweets for local backup and storage.

## Building

```
npm install && npx prisma migrate deploy
```

## Running

### Configure your Twitter OAuth app

1. Create a Twitter app [here](https://developer.twitter.com/en/portal/petition/essential/basic-info).

   - Be sure to save your API Key and API Key Secret.

1. Click on the gear icon to edit your app's settings.
1. Under **User authentication settings** select **Set up**.
1. Under **Type of App** select **Web App, Automated App or Bot**.
1. In the **Callback URI / Redirect URL** input, enter `http://localhost:3000/auth/callback`.
1. In the **Website URL** input, enter your Twitter profile URL (https://twitter.com/username).
1. Save your changes.

### Environment variables

Rename the [`.env.example`](.env.example) file to `.env` and populate it with the following environment variables:

| Variable       | Description                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------- |
| CLIENT_ID      | **API Key** for your [Twitter app](https://developer.twitter.com/en/portal/dashboard).          |
| CLIENT_SECRET  | **API Key Secret** for your [Twitter app](https://developer.twitter.com/en/portal/dashboard).   |
| SESSION_SECRET | A random secret used to secure session cookies. Can be any string.                              |
| BASE_URL       | The URL where your web server is hosted. The server starts on http://localhost:3000 by default. |

### Start the app

```
npm start
```

Once the server has started listening, navigate to http://localhost:3000 in your web browser.

Media files will be imported to `db/client_files`.
