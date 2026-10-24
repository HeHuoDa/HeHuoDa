import { Injectable } from "@nestjs/common";

@Injectable()
export class AuthClock {
  now() {
    return new Date();
  }
}
