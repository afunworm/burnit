import { AfterViewInit, Component, ElementRef, ViewChild, ViewEncapsulation, inject } from '@angular/core';
import { Message } from '../../interfaces/message.interface';
import { AllowIn, ShortcutInput } from 'ng-keyboard-shortcuts';
import * as dayjs from 'dayjs';
import { MessageService } from 'src/app/services/message.service';

@Component({
  selector: 'app-create',
  templateUrl: './create.component.html',
  styleUrls: ['./create.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class CreateComponent implements AfterViewInit {

  @ViewChild('dialog') dialog: ElementRef;
  private _messageService = inject(MessageService);
  message: string = "";
  defaultMessage: string = "password secret\nexpires 1 view\nexpires 1 week\n---\nYour message goes here..."
  showHelp: boolean = false;
  showComplete: boolean = false;
  shortcuts: ShortcutInput[] = [];
  isSubmitting: boolean = false;
  url: string = window.location.protocol + "//" + window.location.host;
  createdURLRef: string = "";

  replaceCommonTimeUnit(input: string): string {

    // Check the only case-sensitive cases for minute & month first
    if (input === "m") return "minute";
    if (input === "M") return "month";

    // Be aware that min might be found inside mins and minute, etc.
    // The safest way is to use if statements
    input = input.toLowerCase();

    if (["minutes", "minute", "min", "mins", "m"].includes(input)) return "minute";
    if (["hours", "hour", "hr", "h"].includes(input)) return "hour";
    if (["days", "day", "d"].includes(input)) return "day";
    if (["weeks", "week", "wk", "wks", "w"].includes(input)) return "week";
    if ([ "months", "month", "mo"].includes(input)) return "month";
    if (["years", "year", "yr", "yrs", "y"].includes(input)) return "year";

    return input;
    
  }

  processMessage(input: string): Message {

    let data: Message = {
      content: "",
      createdAt: new Date(),
      expiresAt: dayjs().add(1, "week").toDate(),
      maxViews: 1,
      usePassword: false,
      views: 0,
      alias: "",
      nocopy: false,
      ref: ""
    }

    /*
     * Find the config by splitting /\n---\n/
     * If the config exists, without checking its validity, it will be in array[0]
    */
    let parts = input.split(/\n---\n/);
    if (parts.length === 1) {
      // There is no config
      data.content = input;
    } else {
      // There are configs, but let's save the content first
      data.content = parts.slice(1).join("");
    }

    // Define keywords
    let acceptableNoCopyKeywords = ["nocopy", "obfuscate", "obfuscated"];
    let acceptableAliasKeywords = ["alias", "name"];
    let acceptablePasswordKeywords = ["password", "pwd", "pw"];
    let acceptableExpirationKeywords = ["expires", "expire", "deletes", "delete", "destroys", "destroy", "removes", "remove"];
    let acceptableExpirationViewUnits = ["views", "view", "v","times", "time", "t"];
    let acceptableExpirationTimeUnits = ["minutes", "minute", "min", "mins", "m", "hours", "hour", "hr", "h", "days", "day", "d", "weeks", "week", "wk", "wks", "w", "months", "month", "mo", "M", "years", "year", "yr", "yrs", "y"];

    /*
     * The first part is config
     * Loop through every line and perform detection of keywords
    */
    let configs = parts[0].split(/\n/);

    configs.forEach(config => {

      // Trim the config for unexpected (mostly at the end) spaces
      config = config.trim();

      // Split the config to command - value, ignoring the number of spaces
      let parts = config.split(/\s+/);

      // If config does not contain any space
      // It's a 1 part config, such as nocopy
      if (parts.length === 1) {

        // Check for nocopy
        // Must also check this for when there are unnecessary params after
        let command = parts[0].toLowerCase();
        if (acceptableNoCopyKeywords.includes(command)) {
          data.nocopy = true;
          return;
        }

      }

      // Now we go on to the check
      let command = parts[0].toLowerCase();
      let params = parts.slice(1).join(" ");

      // First, check for alias keyword
      if (acceptableAliasKeywords.includes(command)) {

        // Make sure params is only number or letters
        if (!/^[A-Za-z0-9]*$/gi.test(params)) {
          alert('Alias can only contain numbers or letters.');
          return;
        }

        if (params.length < 3 || params.length > 20) {
          alert('Alias can only have the length of 3 - 20 characters.');
          return;
        }

        data.alias = params;
        return;
      }

      // Next, check for nocopy
      // Must also check this for when there is no other settings after the command
      if (acceptableNoCopyKeywords.includes(command)) {
        data.nocopy = true;
        return;
      }

      // Next, check for password keyword
      if (acceptablePasswordKeywords.includes(command)) {
        // Encrypt the content
        // We already know that data.content is a string because if not, we would have rejected it
        // The following line is just to get rid of the dumb TS warning type for data.content
        data.content = data.content ? data.content : "";
        data.content = this._messageService.encryptMessage(data.content, params);
        data.usePassword = true;
        return;
      }

      // Next is expiration condition
      // Since this is the last condition, just skip the whole loop
      // if it is not a good condition
      if (!acceptableExpirationKeywords.includes(command)) return;

      // If params.split(/\s+/) has more than 1 element, example 1 day, 2 views, etc.
      // We will check if the first element is valid for a condition and ignore the rest
      // Otherwise, merge the first and the second element, then check for validity
      let paramParts = params.split(/\s+/);

      // If paramParts only has one element, we need to check if it is a valid duration
      // At the most basic level, it should pass /^[0-9]+[a-zA-Z]+$/gi test
      if (paramParts.length === 1) {

        params = paramParts[0];

        // This is not a valid condition
        if (!/^[0-9]+[a-zA-Z]+$/gi.test(params)) return;

        // Since param is now a valid condition with the format of /^[0-9]+[a-zA-Z]+$/gi
        // We can split params into duration - unit
        let parts = params.split(/([a-z]+)/);

        // Since we performed the test earlier, we know that
        // duration is a valid number
        let duration = +parts[0];
        let unit = parts[1];

        // Now we check for duration validity and ignore anything that's not duration
        // For view
        if (acceptableExpirationViewUnits.includes(unit)) {
          data.maxViews = duration;
          return;
        }

        // For time, we need some more manual conversion for the units
        if (acceptableExpirationTimeUnits.includes(unit)) {
          unit = this.replaceCommonTimeUnit(unit);
          data.expiresAt = dayjs().add(duration, unit as dayjs.ManipulateType).toDate();
          return;
        }


      } else {
        // There are more than 1 paramParts, for example, "1 day", "2 minutes", etc.
        // We just need to check the validity of paramPart[0] and paramPart[1]
        // And we can ignore the rest
        
        // Check if duration is a valid number
        if (isNaN(+paramParts[0])) return;

        // Continue since duration is a valid number
        let duration = +paramParts[0];
        let unit = paramParts[1];

        // For view
        if (acceptableExpirationViewUnits.includes(unit)) {
          data.maxViews = duration;
          return;
        }

        // For time, we need some more manual conversion for the units
        if (acceptableExpirationTimeUnits.includes(unit)) {
          unit = this.replaceCommonTimeUnit(unit);
          data.expiresAt = dayjs().add(duration, unit as dayjs.ManipulateType).toDate();
          return;
        }

      }

    });

    return data;

  }

  displayHelpDialog(): void {
    this.showHelp = true;
  }

  reset(): void {
    this.message = "";
  }

  insertPreset(): void {
    this.message = this.defaultMessage; //.replace("***", this._messageService.generateFirestoreId());
  }

  async saveMessage() {
    if (this.isSubmitting) {
      alert("Another message is being created. Please try again.");
      return;
    }
    
    if (this.message.toString().trim().length < 1) {
      alert("Message cannot be blank.");
      return;
    }

    // Process the text
    let data = this.processMessage(this.message);

    // Create entry
    this.isSubmitting = true;

    try {

      const docId = await this._messageService.addMessage(data);
      this.createdURLRef = docId;
      this.isSubmitting = false;
      this.message = '';
      this.showComplete = true;

    } catch (error) {

      console.log(error);
      alert(`Unable to create the secret message. Please try with another alias.\n\nPlease contact the developer if the problem persists.`);
      this.isSubmitting = false;

    }
  }

  ngAfterViewInit(): void {  
    this.shortcuts.push(
      {
          key: "ctrl + s",
          preventDefault: true,
          allowIn: [AllowIn.Textarea, AllowIn.Input, AllowIn.ContentEditable],
          command: async (e) => {
            this.saveMessage();
          }
      },
      {
        key: "ctrl + h",
        preventDefault: true,
        allowIn: [AllowIn.Textarea, AllowIn.Input, AllowIn.ContentEditable],
        command: (e) => {
          this.displayHelpDialog();
        }
      },
      {
        key: "ctrl + r",
        preventDefault: true,
        allowIn: [AllowIn.Textarea, AllowIn.Input, AllowIn.ContentEditable],
        command: (e) => {
          this.reset();
        }
      },
      {
        key: "ctrl + p",
        preventDefault: true,
        allowIn: [AllowIn.Textarea, AllowIn.Input, AllowIn.ContentEditable],
        command: (e) => {
          this.insertPreset();
        }
      },
      {
        key: "esc",
        preventDefault: true,
        allowIn: [AllowIn.Textarea, AllowIn.Input, AllowIn.ContentEditable],
        command: (e) => {
          this.showHelp = false;
          this.showComplete = false;
      }
    }
    ); 
  }

}