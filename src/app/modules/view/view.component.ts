import { AfterViewInit, Component, ViewEncapsulation, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ShortcutInput, AllowIn } from 'ng-keyboard-shortcuts';
import { Message } from 'src/app/interfaces/message.interface';
import { MessageService } from 'src/app/services/message.service';

@Component({
  selector: 'app-view',
  templateUrl: './view.component.html',
  styleUrls: ['./view.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class ViewComponent implements AfterViewInit {

  private _activatedRoute = inject(ActivatedRoute);
  private _messageService = inject(MessageService);
  private _router = inject(Router);
  shortcuts: ShortcutInput[] = [];
  allowView: boolean = false;
  showUnauthorized: boolean = false;
  showError: boolean = false;
  showMessage: boolean = false;
  message: string = "";
  viewsLeft: number = 0;
  usePassword: boolean = false;
  nocopy: boolean = false;
  password: string = "";

  constructor() {
    const messageId = this._activatedRoute.snapshot.params.id;

    this._messageService.getMessageSnapshot(messageId).then(snapshot => {

      if (!snapshot.exists) {
        this.showUnauthorized = true;
        return;
      }

      const data = snapshot.data() as Message;

      // Calculating the number of views left
      this.viewsLeft = data.maxViews - data.views >= 0 ? data.maxViews - data.views : 0;

      // Does the message require decryption key?
      this.usePassword = !!data.usePassword;

      // Does the password require attempt to prevent copy?
      this.nocopy = !!data.nocopy;

      this.allowView = true;

    }).catch(error =>{
      console.log(error);
      this.showUnauthorized = true;
    });
  }

  navigateToCreate() {
    this._router.navigate(['/create']);
  }

  generateRandomString(length: number = 2): string {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789~!@#$%^&*()-_=+[{]}|;:,./?';
    const charactersLength = characters.length;
    let counter = 0;
    while (counter < length) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
      counter += 1;
    }
    return `<span class="obf">${result}</span>`; 
}

  displayMessage(message: string) {
    if (!this.nocopy) {
      this.message = message;
      this.showMessage = true;
      return;
    }

    message = this.generateRandomString() + message.split("").map(letter => {

      return `<span class="nobf">${letter}</span>` + this.generateRandomString();

    }).join("").replaceAll("\n", "<br>");
    this.message = message;
    this.showMessage = true;

  }

  async viewMessage(e?: MouseEvent) {
    if (e) e.preventDefault();

    try {
      const data = await this._messageService.getMessageData() as Message;
      const unencryptedRef = data.ref;
      const messageContentRef = this._messageService.encryptMessageContentRef(unencryptedRef);

      // No encryption needed
      if (!this.usePassword) {
        const message = await this._messageService.getMessageContent(messageContentRef);
        await this._messageService.increaseMessageView();
        this.displayMessage(message);
        return;
      }

      // Encryption required
      try {
        const message = await this._messageService.getMessageContent(messageContentRef);
        let decryptedMessage = await this._messageService.decryptMessage(message, this.password);
        await this._messageService.increaseMessageView();
        this.displayMessage(decryptedMessage);
        return;
      } catch (error) {
        alert('Invalid password.');
        location.reload();
      }
      
    } catch (error) {
      console.log(error);
      this.showError = true;
    }
  }

  ngAfterViewInit(): void {  
    this.shortcuts.push(
      {
          key: "ctrl + s",
          preventDefault: true,
          allowIn: [AllowIn.Textarea, AllowIn.Input, AllowIn.ContentEditable, AllowIn.Select],
          command: async (e) => {
            this.navigateToCreate();
          }
      },
      {
          key: "ctrl + v",
          preventDefault: true,
          allowIn: [AllowIn.Textarea, AllowIn.Input, AllowIn.ContentEditable, AllowIn.Select],
          command: (e) => {
            if (!this.allowView) return;

            this.viewMessage();
          }
      },
    ); 
  }

}
