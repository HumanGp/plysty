import 'dotenv/config';
import prompts from 'prompts';
import { Singleton } from './singleton.js';

export class AuthService extends Singleton {
  client;

  constructor(client) {
    super();
    this.client = client;
  }


  async authenticate() {
    await this.client.start({
      phoneNumber: async () => {
        const res = await prompts({
          type: "text",
          name: "phone",
          message: "Phone number (with country code)"
        });
        return res.phone;
      },
      password: async () => {
        const res = await prompts({
          type: 'password',
          name: 'password',
          message: "2FA password (leave empty if none)"
        });
        return res.password;
      },
      phoneCode: async () => {
        const res = await prompts({
          type: "text",
          name: "code",
          message: "Code you received from Telegram",
        });
        return res.code;
      },
      onError: (err) => console.error(err),
    });

    console.log("\nLogin success!");
    console.log("Session string (save this):\n");
    console.log(this.client.session.save());
    console.log("\n");
  }
}
